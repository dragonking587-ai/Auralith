# Auralith Unreal Engine 5.7 Bridge

This branch is an isolated control plane for connecting ChatGPT/GitHub to a locally running Unreal Engine 5.7 Editor.

## Architecture

```text
ChatGPT
   |
   | writes command JSON
   v
GitHub branch: unreal-control
   |
   | git pull
   v
bridge_client.py on the Windows PC
   |
   | localhost TCP 127.0.0.1:8765
   v
Unreal Engine 5.7 Python runtime
   |
   | executes on the editor thread
   v
Unreal Editor / Assets / Levels / Settings
   |
   | result JSON
   v
bridge_client.py -> Git commit/push -> GitHub -> ChatGPT
```

The production Auralith application and updater are not modified by this branch.

## Control coverage

The bridge is designed for the broadest practical Unreal control surface rather than a small hard-coded action list.

### Layer 1 - safe built-in actions

- `ping`
- `get_project_info`
- `list_actors`
- `spawn_actor`
- `delete_actor` (disabled locally by default)
- `set_actor_transform`
- `get_property`
- `set_property`
- `get_config_property`
- `set_config_property`
- `call_method`
- `call_unreal`
- `execute_console`
- `list_assets`
- `load_asset`
- `save_asset`
- `save_current_level`

### Layer 2 - generic Unreal reflection

`get_property` and `set_property` use Unreal's `get_editor_property()` / `set_editor_property()` interface, so the bridge can work with new UObject types and properties without adding a new bridge command for each one.

`get_config_property` and `set_config_property` operate on Unreal class default objects. This is the main route for Project Settings and Editor Settings that are exposed to Unreal reflection/Python.

### Layer 3 - generic methods and subsystems

`call_method` can target actors, assets, default objects, editor subsystems, engine subsystems, and loaded objects.

`call_unreal` can invoke exposed functions/classes in the `unreal` Python module. This is how we can expand into Sequencer, Cine Camera, Niagara, Movie Render Queue, PCG, materials, animation, asset tools, and plugin APIs without redesigning the transport.

### Layer 4 - advanced Python escape hatch

`python_exec` and `python_eval` exist in the Unreal runtime but the Windows bridge blocks them by default.

To deliberately enable arbitrary Unreal Editor Python, set this **only in the local untracked** `unreal_bridge/local_config.json`:

```json
"allow_unsafe_python": true
```

This provides access to essentially anything exposed by Unreal's Python/Blueprint API, including APIs added by installed Unreal plugins.

### Layer 5 - optional C++ reflection plugin

`plugin/AuralithBridge` is an editor-only plugin scaffold. It exposes generic C++ reflection helpers to Blueprint/Python for cases where normal Python editor properties are insufficient.

It currently provides:

- load a class default object by class path
- get reflected properties as text
- set reflected properties from text
- optionally save config after setting a reflected property
- call zero-parameter reflected functions

The Python bridge works without this plugin. Install it only when we need the extra C++ reflection surface.

### What "everything" means

Anything exposed through Unreal Python, Blueprint reflection, reflected UObject properties, editor subsystems, console commands, or the optional bridge C++ plugin can be controlled through this architecture.

No generic bridge can automatically control private C++ implementation details or arbitrary Slate UI widgets that Unreal does not expose. When we hit one of those, we add a narrowly scoped C++ adapter to `AuralithBridge`, which then becomes callable through the same bridge. This means the architecture does not need to be replaced as coverage grows.

## Safety defaults

The local PC controls the final authority. GitHub commands cannot override these settings.

`config.example.json` defaults to:

```json
{
  "host": "127.0.0.1",
  "port": 8765,
  "allowed_project_file": "",
  "allow_delete": false,
  "allow_console_commands": true,
  "allow_unsafe_python": false
}
```

Important protections:

- TCP server binds to localhost only.
- destructive delete commands are disabled by default.
- arbitrary Python is disabled by default.
- `allowed_project_file` can lock the bridge to one `.uproject` so another open Unreal project cannot be changed accidentally.
- every GitHub command and returned result is auditable.

## First-time installation

### 1. Check out the control branch

From your local Auralith clone:

```powershell
git fetch origin
git checkout unreal-control
git pull origin unreal-control
```

### 2. Enable Unreal plugins

In Unreal Engine 5.7 enable:

- **Python Editor Script Plugin**
- **Editor Scripting Utilities**

Restart Unreal after enabling them.

### 3. Install the Python runtime into your Unreal project

From the Auralith repository root:

```powershell
.\unreal_bridge\install_to_project.ps1 -UProject "C:\Path\To\YourProject\YourProject.uproject"
```

This copies the bridge runtime to your project's `Content/Python` directory and adds a guarded startup block to `Content/Python/init_unreal.py`.

For the optional C++ reflection plugin:

```powershell
.\unreal_bridge\install_to_project.ps1 -UProject "C:\Path\To\YourProject\YourProject.uproject" -InstallCppPlugin
```

The C++ plugin may require Visual Studio Build Tools / a working Unreal C++ toolchain.

### 4. Create local-only bridge settings

```powershell
Copy-Item .\unreal_bridge\config.example.json .\unreal_bridge\local_config.json
```

Edit `local_config.json` and set `allowed_project_file` to the exact project file you want the bridge to control, for example:

```json
"allowed_project_file": "AuralithCinematic.uproject"
```

`local_config.json` is ignored by Git and is not uploaded to GitHub.

### 5. Start the PC bridge

```powershell
.\unreal_bridge\run_bridge.ps1
```

A successful connection shows approximately:

```text
Listening for Unreal Editor on 127.0.0.1:8765
Unreal connection accepted
Unreal ready: project=... engine=5.7...
```

The Unreal Output Log should also show:

```text
[AuralithBridge] Connected to local bridge agent at 127.0.0.1:8765
```

## Command format

Commands are individual JSON files under `unreal_bridge/commands/`.

Example ping:

```json
{
  "id": "000001-ping",
  "action": "ping",
  "args": {}
}
```

Example actor creation:

```json
{
  "id": "000010-light",
  "action": "spawn_actor",
  "args": {
    "class": "PointLight",
    "location": [0, 0, 300],
    "rotation": [0, 0, 0],
    "label": "Bridge_Test_Light"
  }
}
```

Example read of a reflected property:

```json
{
  "id": "000020-read",
  "action": "get_property",
  "args": {
    "target": {
      "kind": "actor",
      "name": "Bridge_Test_Light"
    },
    "property": "intensity"
  }
}
```

Example project/config setting:

```json
{
  "id": "000030-setting",
  "action": "set_config_property",
  "args": {
    "class": "/Script/Engine.RendererSettings",
    "property": "some_reflected_property_name",
    "value": true
  }
}
```

Property names and class paths must match what the installed Unreal build exposes.

## Results

Each command receives a matching result file:

```text
unreal_bridge/results/<command-id>.json
```

The PC agent commits and pushes the result to the `unreal-control` branch. ChatGPT can then inspect the result before issuing the next command.

## Movie-production expansion

The same transport can be extended without replacing it. Planned high-level adapters can cover:

- Sequencer sequences and tracks
- Cine Camera actors and lenses
- animation placement and retargeting
- Niagara systems and user parameters
- lighting and post-process volumes
- materials and Material Instances
- MetaHuman-compatible scene setup where the installed project exposes the APIs
- Movie Render Queue jobs
- render previews and viewport captures
- PCG and world-building tools
- sound placement and timing

Those high-level adapters will sit on top of the generic reflection/call layers already in this branch.
