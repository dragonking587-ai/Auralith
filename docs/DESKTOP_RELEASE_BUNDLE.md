# Desktop release bundle rule

Every Auralith desktop GitHub Release tag must contain BOTH:

- `Auralith-Reborn-<version>-x64-Setup.exe`
- `Auralith-Host-Console-<version>-x64-Setup.exe`

Do not publish a "main" release that only has Reborn.

They remain two side-by-side installers on one tag. They are not a single combined Setup.exe.

Workflow:

1. `Auralith Reborn Preview` creates tag `v<version>` and uploads the main installer.
2. `Build Auralith Host Console` waits for that tag and uploads the Host Console installer to the same tag.

Railway and Android stay separate.
