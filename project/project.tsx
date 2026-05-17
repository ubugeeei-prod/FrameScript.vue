import { VueProjectRoot } from "../src/lib/vue"
import type { ProjectSettings } from "../src/lib/project"
import ProjectVue from "./project.vue"

export const PROJECT_SETTINGS: ProjectSettings = {
  name: "framescript-vue-template",
  width: 1920,
  height: 1080,
  fps: 60,
}

export const PROJECT = () => {
  return (
    <VueProjectRoot component={ProjectVue} projectSettings={PROJECT_SETTINGS} />
  )
}
