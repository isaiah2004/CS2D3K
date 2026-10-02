import type { TabState } from '@/store/workspace'

/** Props every main-area view receives. */
export interface ViewProps {
  tab: TabState
  leafId: string
  /** this tab is the visible tab of its leaf */
  visible: boolean
  /** its leaf is the active (focused) leaf and the tab is visible */
  focused: boolean
}
