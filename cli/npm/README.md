<div align="center">

<a href="https://hookline.vante.app"><img alt="Hookline: Catch every webhook. Replay anything." src="https://hookline.vante.app/readme/banner-dark.webp" width="100%"></a>

<br>

**Forward webhooks to `localhost`, watch them arrive live, replay them and send signed test events, all from your terminal.**

<br>

[![npm version](https://img.shields.io/npm/v/hookline-cli?style=flat-square&color=8b7cf6&logo=npm&logoColor=white)](https://www.npmjs.com/package/hookline-cli)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-8b7cf6?style=flat-square)](https://www.npmjs.com/package/hookline-cli?activeTab=code)
[![Node.js 18+](https://img.shields.io/badge/node-%E2%89%A518-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Native binary](https://img.shields.io/badge/native-Go_binary-00add8?style=flat-square&logo=go&logoColor=white)](https://hookline.vante.app/docs/cli)
[![No install script](https://img.shields.io/badge/install_scripts-none-8b7cf6?style=flat-square)](https://hookline.vante.app/docs/cli)

**[Hookline](https://hookline.vante.app)** ·
**[CLI docs](https://hookline.vante.app/docs/cli)** ·
**[Docs](https://hookline.vante.app/docs)** ·
**[Changelog](https://hookline.vante.app/changelog)**

</div>

<br>

<img alt="A terminal session: install hookline-cli, log in, forward an endpoint to localhost:3000 and replay a failed request" src="https://hookline.vante.app/readme/terminal.webp" width="100%">

## Install

```sh
npm install -g hookline-cli
```

Requires Node.js 18 or newer. npm installs the native binary for your platform (macOS, Linux and Windows on x64 and arm64) as an optional dependency, and no install script runs. Homebrew and Scoop work too:

```sh
brew install --cask kaanxsrd/tap/hookline                              # macOS
scoop bucket add hookline https://github.com/kaanxsrd/scoop-bucket     # Windows
scoop install hookline
```

## Usage

```sh
# Sign in through your browser
hookline login

# Forward an endpoint's webhooks to your local server
hookline listen <slug> --forward http://localhost:3000/api/webhooks

# Watch requests as they arrive
hookline tail <slug>

# Send a captured request again, here to your local server
hookline replay <request-id> --to http://localhost:3000/api/webhooks

# Send a realistic, signed sample event (hookline trigger --list shows them all)
hookline trigger <slug> stripe.payment_intent.succeeded

# List your endpoints, or check for a newer release
hookline endpoints list
hookline update
```

Run `hookline <command> --help` for every flag, or read the [CLI guide](https://hookline.vante.app/docs/cli).

## Self-hosted Hookline

The CLI talks to [hookline.vante.app](https://hookline.vante.app) by default. Point it at your own instance with `--url` or the `HOOKLINE_URL` environment variable.

## License

[GPL-3.0-only](https://www.gnu.org/licenses/gpl-3.0.html) © Vante
