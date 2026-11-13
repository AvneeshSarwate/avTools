import { defineCustomElement } from 'vue'
import PerfPaneRoot from './PerfPaneRoot.vue'

const tagName = 'perf-pane-component'

const PerfPaneElement = defineCustomElement(PerfPaneRoot)

if (!customElements.get(tagName)) {
  customElements.define(tagName, PerfPaneElement)
}

export { PerfPaneElement }
export { PerfPaneClient } from './perfPaneClient'
export type {
  PerfPaneModel,
  SliderModel,
  ToggleModel,
  TabModel,
  TabPageModel,
  WsLike,
} from './perfPaneClient'
