# Auralith 1.0.0-rc.49.4 — Custom Overlay Colors & Effects

Overlay boxes now have independent styles and live effects. New frames start with a subtle obsidian fill and violet/cyan border instead of a solid gold box.

## Customize each box
Open **Overlay**, select a Frame / Panel, Text item, or Web / Song Card, then use **Box Style** and **Box Effects**.

- Choose **Border Color** and a separate **Effect Color**.
- Set border width, corner radius, overall opacity, and glow.
- Set fill color and **Fill Opacity** independently of the border and text; zero gives a transparent center.
- Apply **Obsidian**, **Ice**, **Crimson**, or **Gold** presets, then customize any setting.
- Select **Static**, **Neon Glow**, **Breathing Pulse**, or **Border Chase**.
- Give every animated box its own speed and intensity.
- Enable **Audio Reactive** per box and choose Full Mix, Bass, Low, Mid, High, Beat, or Transient, with independent sensitivity and a smooth attack/release response.

Web cards retain their stable source viewport, Fit/Fill/Stretch/Native behavior, and perspective controls while their surrounding frame can have its own colors and effects.

## Projects and output
Colors, effects, transparency, and audio settings save in normal .auralith projects. Existing saved frames retain their colors, solid fills, and static behavior. Changing one box does not change another.

The overlay remains visible in Preview and Clean Capture. Editor outlines and labels stay out of Clean Capture. These HTML overlay surfaces use the existing window/clean-capture path; the current Virtual Camera framebuffer does not include HTML overlays or embedded iframe content.

The existing Neon Glow center fix, natural flame rebuild, 80 effects, quality controls, and editor workflows remain included.

## Update compatibility
The release retains the existing application identity, updater public key, and signed Windows installer flow. Version **1.0.0-rc.49.4** is newer than **1.0.0-rc.49.3.10**, including with the comparison used by older rc.49.3 clients.

Use **Settings → Check for Updates → Download & Install**. The update saves the current project recovery data before installing and restarting. The signed installer and latest.json are published to this release, with the updater-latest feed refreshed after the installer is available.
