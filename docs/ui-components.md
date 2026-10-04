# MediaFlock UI components

MediaFlock uses the free BoardUI Button, ButtonLink, Avatar, Chip and floating Sidebar source requested by the owner. The registry snapshots were retrieved on October 4, 2026. They are source files in the app, rather than a runtime BoardUI dependency. The MIT notice is included at `apps/web/public/licenses/boardui.txt`.

Sources: [Button](https://www.boardui.com/components/button), [Avatar](https://www.boardui.com/components/avatar), [Chip](https://www.boardui.com/components/chip), [Sidebar](https://www.boardui.com/components/sidebar), [free repository and license](https://github.com/BoardUI/boardui).

The shared components live under `apps/web/components/base`. BoardUI theme and typography tokens live under `apps/web/styles`; the class-merging and directional-icon helpers live under `apps/web/utils`. Dependencies are pinned to `tailwind-merge` 3.6.0 and Remix Icon 4.9.0. Existing locally served Geist and Instrument Serif fonts remain in use.

The Button accepts a `contentLayout="custom"` extension for calendar entries, content rows and similar complex controls. This keeps their children in the original layout rather than clipping them inside a one-line label. Native `type`, disabled conditions, events and accessibility attributes stay with the callers. ButtonLink keeps actual anchor behavior, including downloads and external destinations. Application controls use these components; browser-native media controls remain owned by the browser.

The Sidebar retains BoardUI's floating panel, selected blue gradient, and collapsing labels. Its application interface receives actual navigation, authenticated user details and controlled layout state from MediaFlock. It does not include BoardUI's template records or demonstration account menus. The mobile drawer supports Escape, keyboard focus containment and focus restoration. The collapsed preference persists across reloads; sign-out remains accessible in the collapsed rail.

Status uses semantic Chip colors without changing delivery or approval meanings. Brand graphics remain authentic service/platform graphics. The authenticated profile uses the BoardUI Avatar and the account's own initials.

The existing EvilCharts graphs and Thinking Orbs remain in use. No backend, account permissions, credentials, deployment environment, Final Approval rule or delivery behavior is changed by the visual-control migration.
