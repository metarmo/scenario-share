# Design QA — document status placement

## Comparison target

- Source visual truth: `/var/folders/xq/tk9y2gnd1zg30qpvjcyjx1v40000gn/T/codex-clipboard-987bda73-fe8c-482e-881e-89c1e11f68db.png`
- Browser-rendered implementation: `/Users/leeeohjin/.codex/visualizations/2026/08/03/019fc804-9cc9-78a1-84ca-b8c61cd7e288/scenario-share-document-status/document-status-saved-desktop.png`
- Combined comparison evidence: `/Users/leeeohjin/.codex/visualizations/2026/08/03/019fc804-9cc9-78a1-84ca-b8c61cd7e288/scenario-share-document-status/document-status-comparison.png`
- Additional state evidence:
  - `/Users/leeeohjin/.codex/visualizations/2026/08/03/019fc804-9cc9-78a1-84ca-b8c61cd7e288/scenario-share-document-status/document-status-dirty-desktop.png`
  - `/Users/leeeohjin/.codex/visualizations/2026/08/03/019fc804-9cc9-78a1-84ca-b8c61cd7e288/scenario-share-document-status/document-status-readonly-desktop.png`
  - `/Users/leeeohjin/.codex/visualizations/2026/08/03/019fc804-9cc9-78a1-84ca-b8c61cd7e288/scenario-share-document-status/document-status-saved-mobile.png`

## Normalization

- Source pixels: 623 × 240 at the supplied density.
- Desktop implementation pixels and CSS viewport: 1440 × 900, device scale factor 1.
- Focused page-canvas crop: 623 × 240 from the implementation, compared at 1:1 with the supplied source.
- Mobile implementation pixels and CSS viewport: 390 × 844, device scale factor 1.
- State: current document open, connected, editor role, saved; dirty, saving, and read-only variants were checked separately.

## Findings

No actionable P0, P1, or P2 differences remain.

- Information placement: the save/access/collaboration metadata row is absent from the paper canvas. The title area contains only the title input, and document body content follows it.
- Status destination: the toolbar now exposes `모든 변경 저장됨`, `저장되지 않은 변경`, `변경사항 저장 중`, and `읽기 전용` next to the version-save action.
- Fonts and typography: existing Inter/Pretendard fallbacks, title weight and size, and compact toolbar text are preserved. The relocated status follows the toolbar's existing 9px metadata scale.
- Spacing and layout rhythm: removing the 22px metadata row and its 10px top margin eliminates the unwanted in-document chrome. The existing 36px desktop and 28px mobile title-to-body spacing remain consistent.
- Colors and visual tokens: saved, dirty, saving, and read-only states use the existing muted green, amber, purple, and neutral-gray language without introducing new brand colors.
- Image quality and asset fidelity: no image assets were added or replaced. Icons use the project's existing React Icons library.
- Copy and content: status copy is explicit and no longer duplicated. The clean-state action is labeled `버전 저장`, separating the action from the `모든 변경 저장됨` status.
- Responsiveness: at 390px the existing horizontally scrollable toolbar reaches the status/save group without clipping, while the paper contains no status metadata.
- Accessibility: the document status is an atomic polite live region; saving disables its action, and read-only mode omits the save action.

## Full-view comparison evidence

The desktop render shows the status aligned with the existing save controls outside the page canvas. The page itself contains the title and body only, with no duplicate save or collaborator line.

## Focused region comparison evidence

The combined comparison image places the supplied 623 × 240 source crop, a matching 623 × 240 implementation crop, and the destination toolbar crop in one image. It confirms that the title typography remains consistent, the inner metadata row is removed, and `모든 변경 저장됨` appears beside `버전 저장` in the toolbar.

## Interaction and console checks

- Verified saved, dirty, saving, and read-only render states.
- Verified the saving action is disabled while saving and absent in read-only mode.
- Verified the mobile toolbar can horizontally reveal the status/save group.
- Browser console errors and warnings: none in the clean verification run.

## Comparison history

- Pass 1: no P0/P1/P2 visual mismatch was found after implementation; no visual correction loop was required.

## Follow-up polish

- P3: a future mobile-toolbar redesign could prioritize save/status controls earlier in the horizontal order, but the current behavior matches the existing scroll interaction and does not block this change.

final result: passed
