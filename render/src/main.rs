pub mod ffmpeg;

use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use chromiumoxide::{
    Browser, Handler, Page, cdp::browser_protocol::page::CaptureScreenshotFormat,
    handler::viewport::Viewport, page::ScreenshotParams,
};
use futures::{StreamExt, stream::FuturesUnordered};

use chromiumoxide::browser::BrowserConfig;
use reqwest::{Client, RequestBuilder};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};

use crate::ffmpeg::{AudioPlanResolved, SegmentWriter, mux_audio_plan_into_mp4};

#[derive(Serialize)]
struct ProgressPayload {
    completed: usize,
    total: usize,
}

#[derive(Deserialize)]
struct CancelResponse {
    canceled: bool,
}

static CHROMIUM_EXECUTABLE: OnceLock<Option<PathBuf>> = OnceLock::new();

struct TempWorkspace {
    path: PathBuf,
}

impl TempWorkspace {
    fn create() -> Result<Self, Box<dyn std::error::Error>> {
        let base = std::env::temp_dir();
        let path = base.join(format!(
            "framescript-render-{}-{}",
            std::process::id(),
            chrono_like_timestamp()
        ));
        std::fs::create_dir_all(&path)?;
        Ok(Self { path })
    }
}

impl Drop for TempWorkspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn chrono_like_timestamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn parse_bool_token(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn backend_base_url() -> String {
    std::env::var("FRAMESCRIPT_BACKEND_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "http://127.0.0.1:3000".to_string())
}

fn backend_endpoint(path: &str) -> String {
    format!("{}/{}", backend_base_url(), path.trim_start_matches('/'))
}

fn with_backend_auth(request: RequestBuilder) -> RequestBuilder {
    match std::env::var("FRAMESCRIPT_BACKEND_TOKEN") {
        Ok(token) if !token.trim().is_empty() => request.header("x-framescript-token", token),
        _ => request,
    }
}

async fn backend_post_json<T: Serialize + ?Sized>(
    client: &Client,
    url: &str,
    payload: &T,
) -> Result<(), reqwest::Error> {
    with_backend_auth(client.post(url).json(payload))
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

async fn backend_post_empty(client: &Client, url: &str) -> Result<(), reqwest::Error> {
    with_backend_auth(client.post(url))
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

async fn backend_get(client: &Client, url: &str) -> Result<reqwest::Response, reqwest::Error> {
    with_backend_auth(client.get(url))
        .send()
        .await?
        .error_for_status()
}

fn resolve_chromium_executable() -> Option<PathBuf> {
    CHROMIUM_EXECUTABLE
        .get_or_init(|| {
            let path = std::env::var("FRAMESCRIPT_CHROMIUM_PATH")
                .or_else(|_| std::env::var("PUPPETEER_EXECUTABLE_PATH"))
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .map(PathBuf::from);

            if let Some(path) = path
                && path.is_file()
            {
                return Some(path);
            }
            None
        })
        .clone()
}

async fn spawn_browser_instance(
    profile_dir: PathBuf,
    width: u32,
    height: u32,
) -> Result<(Browser, Handler), Box<dyn std::error::Error>> {
    // Keep profile dir alive for the whole worker lifetime.
    std::fs::create_dir_all(&profile_dir)?;

    let mut builder = BrowserConfig::builder()
        .new_headless_mode()
        .viewport(Viewport {
            width,
            height,
            device_scale_factor: None,
            emulating_mobile: false,
            is_landscape: false,
            has_touch: false,
        })
        //.arg("--use-angle=swiftshader")
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .request_timeout(Duration::from_hours(24))
        .user_data_dir(profile_dir);

    if let Some(path) = resolve_chromium_executable() {
        builder = builder.chrome_executable(path);
    }

    let config = builder.build()?;

    let (browser, handler) = Browser::launch(config).await?;
    Ok((browser, handler))
}

async fn promote_output(
    working_output: &Path,
    output_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    if working_output == output_path {
        return Ok(());
    }

    if let Some(parent) = output_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let output_name = output_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("output.mp4");
    let promote_path = output_path.with_file_name(format!(
        ".{output_name}.framescript-{}.tmp",
        std::process::id()
    ));
    tokio::fs::remove_file(&promote_path).await.ok();

    if let Err(err) = tokio::fs::rename(working_output, &promote_path).await {
        eprintln!("[render] temp rename failed ({err}), falling back to copy");
        tokio::fs::copy(working_output, &promote_path).await?;
        tokio::fs::remove_file(working_output).await.ok();
    }

    tokio::fs::remove_file(output_path).await.ok();
    tokio::fs::rename(&promote_path, output_path).await?;
    Ok(())
}

async fn wait_for_next_frame(page: &Page) {
    let script = r#"
        (async () => {
          await new Promise(resolve => {
            requestAnimationFrame(() => {
              requestAnimationFrame(resolve);
            });
          });
        })()
    "#;
    page.evaluate(script).await.unwrap();
}

async fn wait_for_frame_api(page: &Page) {
    let script = r#"
        (async () => {
          const start = Date.now();
          while (true) {
            const api = window.__frameScript;
            if (api && typeof api.setFrame === "function") return true;
            if (Date.now() - start > 15000) {
              throw new Error("frameScript setFrame not available");
            }
            await new Promise(resolve => {
              requestAnimationFrame(() => {
                requestAnimationFrame(resolve);
              });
            });
          }
        })()
    "#;
    page.evaluate(script).await.unwrap();
}

async fn wait_for_animation_ready(page: &Page) {
    let script = r#"
        (async () => {
          const api = window.__frameScript;
          if (api && typeof api.waitAnimationsReady === "function") {
            await api.waitAnimationsReady();
          }
        })()
    "#;
    page.evaluate(script).await.unwrap();
}

async fn wait_for_draw_text_ready(page: &Page) {
    let script = r#"
        (async () => {
          const api = window.__frameScript;
          if (api && typeof api.waitDrawTextReady === "function") {
            await api.waitDrawTextReady();
          }
        })()
    "#;
    page.evaluate(script).await.unwrap();
}

async fn wait_for_images_ready(page: &Page) {
    let script = r#"
        (async () => {
          const api = window.__frameScript;
          if (api && typeof api.waitImagesReady === "function") {
            await api.waitImagesReady();
          }
        })()
    "#;
    page.evaluate(script).await.unwrap();
}

async fn wait_for_audio_waveforms_ready(page: &Page) {
    let script = r#"
        (async () => {
          const api = window.__frameScript;
          if (api && typeof api.waitAudioWaveformsReady === "function") {
            await api.waitAudioWaveformsReady();
          }
        })()
    "#;
    page.evaluate(script).await.unwrap();
}

async fn wait_for_media_metadata_ready(page: &Page) {
    let script = r#"
        (async () => {
          const api = window.__frameScript;
          if (api && typeof api.waitMediaMetadataReady === "function") {
            await api.waitMediaMetadataReady();
          }
        })()
    "#;
    page.evaluate(script).await.unwrap();
}

async fn wait_for_psd_ready(page: &Page) {
    let script = r#"
        (async () => {
          const api = window.__frameScript;
          if (api && typeof api.waitPsdReady === "function") {
            await api.waitPsdReady();
          }
        })()
    "#;
    page.evaluate(script).await.unwrap();
}

async fn wait_for_psd_frame(page: &Page, frame: usize) {
    let script = format!(
        r#"
        (async () => {{
          const api = window.__frameScript;
          if (api && typeof api.waitPsdFrame === "function") {{
            try {{
              await api.waitPsdFrame({});
            }} catch (_e) {{
              // ignore
            }}
          }}
        }})()
    "#,
        frame
    );
    page.evaluate(script).await.unwrap();
}

async fn wait_for_webgl_ready(page: &Page) {
    let script = r#"
        (async () => {
          const api = window.__frameScript;
          if (api && typeof api.waitWebGLReady === "function") {
            await api.waitWebGLReady();
          }
        })()
    "#;
    page.evaluate(script).await.unwrap();
}

async fn wait_for_webgl_frame(page: &Page, frame: usize) {
    let script = format!(
        r#"
        (async () => {{
          const api = window.__frameScript;
          if (api && typeof api.waitWebGLFrame === "function") {{
            try {{
              await api.waitWebGLFrame({});
            }} catch (_e) {{
              // ignore
            }}
          }}
        }})()
    "#,
        frame
    );
    page.evaluate(script).await.unwrap();
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = std::env::args().collect::<Vec<String>>();

    if args.len() < 2 {
        return Err("Invalid command.".into());
    }

    let splited = args[1].split(":").collect::<Vec<_>>();

    if splited.len() != 7 && splited.len() != 9 {
        return Err("Invalid command(split).".into());
    }

    let width = splited[0].parse::<u32>()?;
    let height = splited[1].parse::<u32>()?;
    let fps = splited[2].parse::<f64>()?;
    let total_frames = splited[3].parse::<usize>()?;
    let workers = splited[4].parse::<usize>()?;
    let encode = splited[5].to_string();
    let preset = splited[6].to_string();
    let ffmpeg_threads = splited
        .get(7)
        .and_then(|raw| raw.parse::<u32>().ok())
        .map(|value| value.max(1))
        .or(Some(1));
    let ffmpeg_low_memory = splited
        .get(8)
        .and_then(|raw| parse_bool_token(raw))
        .unwrap_or(true);

    let worker_count = workers.max(1);
    let base_chunk = total_frames / worker_count;
    let remainder = total_frames % worker_count;
    let progress_url = std::env::var("RENDER_PROGRESS_URL")
        .unwrap_or_else(|_| backend_endpoint("render_progress"));
    let progress_client = Client::new();
    let reset_url = std::env::var("RENDER_RESET_URL").unwrap_or_else(|_| backend_endpoint("reset"));
    let _ = backend_post_empty(&progress_client, &reset_url).await;
    let completed = Arc::new(AtomicUsize::new(0));
    let total_frames_usize = total_frames;

    let cancel_url =
        std::env::var("RENDER_CANCEL_URL").unwrap_or_else(|_| backend_endpoint("is_canceled"));
    let is_canceled = Arc::new(AtomicBool::new(false));
    let is_canceled_clone = is_canceled.clone();
    tokio::spawn(async move {
        loop {
            let client = Client::new();
            let is_canceled = match backend_get(&client, &cancel_url).await {
                Ok(resp) => match resp.json::<CancelResponse>().await {
                    Ok(body) => body.canceled,
                    Err(_) => false,
                },
                Err(_) => false,
            };

            if is_canceled {
                is_canceled_clone.store(true, Ordering::Relaxed);
                break;
            }

            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });

    // initialize progress
    let _ = backend_post_json(
        &progress_client,
        &progress_url,
        &ProgressPayload {
            completed: 0,
            total: total_frames_usize,
        },
    )
    .await;

    // share progress
    let progress_url_clone = progress_url.clone();
    let completed_clone = completed.clone();
    let is_canceled_clone = is_canceled.clone();
    tokio::spawn(async move {
        loop {
            let client = Client::new();
            let _ = backend_post_json(
                &client,
                &progress_url_clone,
                &ProgressPayload {
                    completed: completed_clone.load(Ordering::Relaxed),
                    total: total_frames,
                },
            )
            .await;

            if is_canceled_clone.load(Ordering::Relaxed) {
                break;
            }

            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    });

    // Render page URL:
    // - Dev: defaults to Vite dev server.
    // - Non-dev: Electron can pass a `file://.../dist-render/render.html` URL.
    let url = std::env::var("RENDER_PAGE_URL")
        .or_else(|_| std::env::var("RENDER_DEV_SERVER_URL"))
        .unwrap_or_else(|_| "http://localhost:5174/render".to_string());

    let mut tasks = FuturesUnordered::new();
    let mut launched_worker_ids = Vec::new();

    let output_path =
        std::env::var("RENDER_OUTPUT_PATH").unwrap_or_else(|_| "output.mp4".to_string());
    let output_path = PathBuf::from(output_path);

    let workspace = TempWorkspace::create()?;
    let frame_directory = workspace.path.clone();
    tokio::fs::create_dir_all(frame_directory.join("profiles")).await?;

    let start = Instant::now();

    let mut ranges = Vec::new();
    for worker_id in 0..worker_count {
        let start = worker_id * base_chunk;
        let end = start + base_chunk;
        if start < end {
            ranges.push((start, end));
        }
    }
    if remainder > 0 {
        let start = worker_count * base_chunk;
        let end = total_frames;
        if start < end {
            ranges.push((start, end));
        }
    }

    for (worker_id, (start, end)) in ranges.into_iter().enumerate() {
        launched_worker_ids.push(worker_id);
        let encode_clone = encode.clone();
        let preset_clone = preset.clone();
        let ffmpeg_threads_clone = ffmpeg_threads;
        let ffmpeg_low_memory_clone = ffmpeg_low_memory;

        let page_url = url.clone();
        let frame_directory = frame_directory.clone();
        let completed_clone = completed.clone();
        let is_canceled_clone = is_canceled.clone();
        tasks.push(tokio::spawn(async move {
            let profile_dir = frame_directory
                .join("profiles")
                .join(format!("profile-{worker_id:03}"));

            let (mut browser, mut handler) = spawn_browser_instance(profile_dir, width, height)
                .await
                .map_err(|error| format!("failed to launch browser worker {worker_id}: {error}"))?;

            tokio::spawn(async move { while handler.next().await.is_some() {} });

            let out = frame_directory.join(format!("segment-{worker_id:03}.mp4"));
            let out_string = out.to_string_lossy().into_owned();

            let mut writer = SegmentWriter::new(
                &out_string,
                width,
                height,
                fps,
                18,
                &encode_clone,
                Some(&preset_clone),
                Some(fps as u32),
                ffmpeg_threads_clone,
                ffmpeg_low_memory_clone,
            )
            .await
            .map_err(|error| {
                format!("worker {worker_id}: failed to create ffmpeg writer: {error}")
            })?;

            let page = browser
                .new_page(page_url)
                .await
                .map_err(|error| format!("worker {worker_id}: failed to open page: {error}"))?;
            page.wait_for_navigation()
                .await
                .map_err(|error| format!("worker {worker_id}: navigation failed: {error}"))?;
            wait_for_frame_api(&page).await;
            wait_for_animation_ready(&page).await;
            wait_for_media_metadata_ready(&page).await;
            wait_for_draw_text_ready(&page).await;
            wait_for_audio_waveforms_ready(&page).await;
            wait_for_psd_ready(&page).await;
            wait_for_webgl_ready(&page).await;

            for frame in start..end {
                if is_canceled_clone.load(Ordering::Relaxed) {
                    writer.abort().await;
                    let _ = browser.close().await;
                    return Err("render canceled".to_string());
                }

                wait_for_next_frame(&page).await;

                let js = format!(
                    r#"
                    (() => {{
                      const api = window.__frameScript;
                      if (api && typeof api.setFrame === "function") {{
                        api.setFrame({});
                      }}
                    }})()
                    "#,
                    frame
                );
                page.evaluate(js).await.map_err(|error| {
                    format!("worker {worker_id}: setFrame eval failed: {error}")
                })?;

                wait_for_next_frame(&page).await;

                let script = format!(
                    r#"
                    (async () => {{
                      const api = window.__frameScript;
                      if (api && typeof api.waitCanvasFrame === "function") {{
                        try {{
                          await api.waitCanvasFrame({});
                        }} catch (_e) {{
                          // ignore
                        }}
                      }}
                    }})()
                "#,
                    frame
                );
                page.evaluate(script).await.map_err(|error| {
                    format!("worker {worker_id}: waitCanvasFrame eval failed: {error}")
                })?;

                wait_for_audio_waveforms_ready(&page).await;
                wait_for_psd_frame(&page, frame).await;
                wait_for_images_ready(&page).await;
                wait_for_webgl_frame(&page, frame).await;

                let bytes = page
                    .screenshot(
                        ScreenshotParams::builder()
                            .format(CaptureScreenshotFormat::Png)
                            .omit_background(true)
                            .build(),
                    )
                    .await
                    .map_err(|error| format!("worker {worker_id}: screenshot failed: {error}"))?;

                writer
                    .write_png_frame(&bytes)
                    .await
                    .map_err(|error| format!("worker {worker_id}: ffmpeg write failed: {error}"))?;

                completed_clone.fetch_add(1, Ordering::Relaxed);

                if is_canceled_clone.load(Ordering::Relaxed) {
                    writer.abort().await;
                    let _ = browser.close().await;
                    return Err("render canceled".to_string());
                }
            }

            writer
                .finish()
                .await
                .map_err(|error| format!("worker {worker_id}: ffmpeg finalize failed: {error}"))?;

            browser
                .close()
                .await
                .map_err(|error| format!("worker {worker_id}: browser close failed: {error}"))?;

            Ok::<(), String>(())
        }));
    }

    while let Some(task_result) = tasks.next().await {
        match task_result {
            Ok(Ok(())) => {}
            Ok(Err(worker_error)) => return Err(Box::<dyn std::error::Error>::from(worker_error)),
            Err(join_error) => {
                return Err(Box::<dyn std::error::Error>::from(format!(
                    "render worker panicked: {join_error}"
                )));
            }
        }
    }

    if is_canceled.load(Ordering::Relaxed) {
        return Err("render canceled".into());
    }

    let mut segs = Vec::new();

    for worker_id in launched_worker_ids {
        let path = frame_directory.join(format!("segment-{worker_id:03}.mp4"));
        if tokio::fs::metadata(&path).await.is_ok() {
            segs.push(path);
        }
    }

    let working_output = frame_directory.join("output.mp4");
    crate::ffmpeg::concat_segments_mp4(segs, &working_output).await?;

    let audio_plan_url = std::env::var("RENDER_AUDIO_PLAN_URL")
        .unwrap_or_else(|_| backend_endpoint("render_audio_plan"));
    let audio_plan_client = Client::new();
    if let Ok(resp) = backend_get(&audio_plan_client, &audio_plan_url).await
        && resp.status().is_success()
        && let Ok(plan) = resp.json::<AudioPlanResolved>().await
        && !plan.segments.is_empty()
    {
        let input_video = working_output.clone();
        let temp_video = frame_directory.join("output.audio.mp4");
        mux_audio_plan_into_mp4(&input_video, &temp_video, &plan, total_frames, fps).await?;
        tokio::fs::remove_file(&input_video).await.ok();
        tokio::fs::rename(&temp_video, &input_video).await?;
    }

    if is_canceled.load(Ordering::Relaxed) {
        return Err("render canceled".into());
    }

    promote_output(&working_output, &output_path).await?;

    let final_completed = completed.load(Ordering::Relaxed);
    let _ = backend_post_json(
        &progress_client,
        &progress_url,
        &ProgressPayload {
            completed: final_completed,
            total: total_frames_usize,
        },
    )
    .await;

    let _ = backend_post_empty(&progress_client, &reset_url).await;

    println!("TOTAL : {}[ms]", start.elapsed().as_millis());

    Ok(())
}
