# @hookline/cli

The `hookline` command-line tool: forward webhooks to localhost, watch them live, replay them and send signed test events.

```sh
npm install -g @hookline/cli
hookline login
hookline listen <slug> --forward http://localhost:3000/api/webhooks
```

This package installs a native binary for your platform (macOS, Linux and Windows on x64 and arm64) through an optional dependency. No install script runs.

Documentation: https://github.com/kaanxsrd/hookline · License: MIT
