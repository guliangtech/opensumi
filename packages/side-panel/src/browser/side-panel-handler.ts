import { Panel, BoxLayout, BoxPanel, Widget, SplitPanel, Title } from '@phosphor/widgets';
import { SideTabBar } from './side-bar';
import { TheiaDockPanel } from './theia-dock-panel';
import { TabBarRenderer } from './side-bar-renderer';
import { Injectable, Autowired } from '@ali/common-di';
import { find, some } from '@phosphor/algorithm';

const COLLAPSED_CLASS = 'theia-mod-collapsed';

@Injectable()
export class SidePanelHandler {
  sideBar!: SideTabBar;

  dockPanel!: TheiaDockPanel;

  container!: Panel;

  @Autowired()
  renderer!: TabBarRenderer;

  readonly state: SidePanelState = {
    empty: true,
    expansion: ExpansionState.collapsed,
    pendingUpdate: Promise.resolve(),
  };

  addTab(widgetTitle: Title<Widget>) {
    this.sideBar.addTab(widgetTitle);
  }

  create() {
    this.sideBar = this.createSideBar();
    this.dockPanel = this.createSidePanel();
    this.container = this.createContainer();
  }

  /**
   * Activate a widget residing in the side panel by ID.
   *
   * @returns the activated widget if it was found
   */
  activate(id: string): Widget | undefined {
    const widget = this.expand(id);
    if (widget) {
      widget.activate();
    }
    return widget;
  }

  /**
   * Expand a widget residing in the side panel by ID. If no ID is given and the panel is
   * currently collapsed, the last active tab of this side panel is expanded. If no tab
   * was expanded previously, the first one is taken.
   *
   * @returns the expanded widget if it was found
   */
  expand(id?: string): Widget | undefined {
    if (id) {
      const widget = find(this.dockPanel.widgets(), (w) => w.id === id);
      if (widget) {
        this.sideBar.currentTitle = widget.title;
      }
      return widget;
    } else if (this.sideBar.currentTitle) {
      return this.sideBar.currentTitle.owner;
    } else if (this.sideBar.titles.length > 0) {
      let index = this.state.lastActiveTabIndex;
      if (!index) {
        index = 0;
      } else if (index >= this.sideBar.titles.length) {
        index = this.sideBar.titles.length - 1;
      }
      const title = this.sideBar.titles[index];
      this.sideBar.currentTitle = title;
      return title.owner;
    } else {
      // Reveal the tab bar and dock panel even if there is no widget
      // The next call to `refreshVisibility` will collapse them again
      this.state.expansion = ExpansionState.expanding;
      let relativeSizes: number[] | undefined;
      const parent = this.container.parent;
      if (parent instanceof SplitPanel) {
        relativeSizes = parent.relativeSizes();
      }
      this.container.removeClass(COLLAPSED_CLASS);
      this.container.show();
      this.sideBar.show();
      this.dockPanel.node.style.minWidth = '0';
      this.dockPanel.show();
      if (relativeSizes && parent instanceof SplitPanel) {
        // Make sure that the expansion animation starts at zero size
        parent.setRelativeSizes(relativeSizes);
      }
      if (this.state.expansion === ExpansionState.expanding) {
        this.state.expansion = ExpansionState.expanded;
      }
    }
  }

  /**
   * Collapse the sidebar so no items are expanded.
   */
  collapse(): void {
    if (this.sideBar.currentTitle) {
      // tslint:disable-next-line:no-null-keyword
      this.sideBar.currentTitle = null;
    } else {
      // TODO resize相关逻辑
      // this.refresh();
    }
  }

  protected createSideBar(): SideTabBar {
    const sideBar = new SideTabBar({
      // Tab bar options
      orientation: 'vertical',
      insertBehavior: 'none',
      removeBehavior: 'select-previous-tab',
      allowDeselect: false,
      tabsMovable: true,
      renderer: this.renderer,
    });
    // TODO event listening
    sideBar.tabAdded.connect((sender, { title }) => {
      const widget = title.owner;
      if (!some(this.dockPanel.widgets(), (w) => w === widget)) {
          this.dockPanel.addWidget(widget);
      }
    }, this);
    sideBar.tabActivateRequested.connect((sender, { title }) => title.owner.activate());
    sideBar.tabCloseRequested.connect((sender, { title }) => title.owner.close());
    return sideBar;
  }

  protected createSidePanel(): TheiaDockPanel {
    const sidePanel = new TheiaDockPanel({
      mode: 'single-document',
    });
    // TODO event listening
    return sidePanel;
  }

  protected createContainer(): Panel {
    const contentBox = new BoxLayout({ direction: 'top-to-bottom', spacing: 0 });
    BoxPanel.setStretch(this.dockPanel, 1);
    contentBox.addWidget(this.dockPanel);
    const contentPanel = new BoxPanel({ layout: contentBox });
    const direction: BoxLayout.Direction = 'left-to-right';

    const containerLayout = new BoxLayout({ direction, spacing: 0 });
    BoxPanel.setStretch(this.sideBar, 0);
    containerLayout.addWidget(this.sideBar);
    BoxPanel.setStretch(contentPanel, 1);
    containerLayout.addWidget(contentPanel);
    const boxPanel = new BoxPanel({ layout: containerLayout });
    boxPanel.id = 'theia-left-content-panel';
    return boxPanel;
  }

}

export interface SidePanelState {
  /**
   * Indicates whether the panel is empty.
   */
  empty: boolean;
  /**
   * Indicates whether the panel is expanded, collapsed, or in a transition between the two.
   */
  expansion: ExpansionState;
  /**
   * A promise that is resolved when the currently pending side panel updates are done.
   */
  pendingUpdate: Promise<void>;
  /**
   * The index of the last tab that was selected. When the panel is expanded, it tries to restore
   * the tab selection to the previous state.
   */
  lastActiveTabIndex?: number;
  /**
   * The width or height of the panel before it was collapsed. When the panel is expanded, it tries
   * to restore its size to this value.
   */
  lastPanelSize?: number;
}

export enum ExpansionState {
  collapsed = 'collapsed',
  expanding = 'expanding',
  expanded = 'expanded',
  collapsing = 'collapsing',
}
