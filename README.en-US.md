# Aaalice MC Translator

> A Windows desktop tool for localizing Minecraft modpacks. It scans mod language files, reuses existing translations, fills the remaining gaps with an LLM, and exports a ready-to-use resource pack.

<p align="center">
  <img src="assets/app-icon-source.png" alt="Aaalice MC Translator" width="128" />
</p>

<p align="center">
  <a href="README.md">简体中文</a> · <b>English</b>
</p>

---

## Features

- Scan a Minecraft instance and extract `.json` / `.lang` language files from mod JARs.
- Reuse existing resource packs, the local dictionary, and CFPA reference translations.
- Batch-translate missing entries through DeepSeek, OpenAI, or any OpenAI-compatible API.
- Protect Minecraft formatting codes, variables, item tags, and Java format placeholders.
- Track translation jobs, logs, retries, failed entries, and review edits.
- Package translations into a standard Minecraft resource pack zip without modifying original mod JARs.

## Quick Start

### Requirements

- Windows 10 / Windows 11 64-bit
- A standard Minecraft instance directory, such as PCL2, HMCL, or the official launcher
- An available LLM API key

### Install

Download the latest installer from [Releases](https://github.com/Aaalice233/Aaalice_Minecraft_Translator/releases).

The app supports automatic updates from `Settings -> About & Updates`.

### Workflow

```text
Select MC instance -> Scan mods -> Configure LLM API -> Translate -> Review -> Package
```

The generated resource pack can be copied into the instance `resourcepacks/` directory.

## Development

### Requirements

- Node.js 20+
- npm 10+
- Rust stable

### Commands

| Task | Command |
| --- | --- |
| Start frontend dev server | `npm run dev` |
| Start Tauri dev mode | `npm run tauri dev` |
| Build frontend | `npm run build` |
| Run frontend tests | `npm run test:unit` |
| Run Rust tests | `npm run test:rust` |
| Build NSIS installer | `npm run package:exe` |
| Build portable exe | `npm run package:app` |

## Project Structure

```text
Aaalice_Minecraft_Translator/
├── assets/                  App icons and resource-pack icon
├── data/                    Local runtime data, ignored by .gitignore
├── docs/                    Product, architecture, UI, and test docs
├── logs/                    Runtime logs, ignored by .gitignore
├── scripts/                 Packaging and helper scripts
├── src/                     React + TypeScript frontend
│   ├── api/                 Tauri API wrapper and browser mocks
│   ├── app/                 App shell, Context, and global state sync
│   ├── components/          Shared UI components
│   ├── hooks/               Shared React hooks
│   ├── i18n/                UI translation dictionary
│   ├── pages/               Feature pages
│   ├── stores/              Zustand stores
│   └── styles/              Global styles
├── src-tauri/               Tauri 2 + Rust backend
│   ├── src/commands/        Tauri commands
│   ├── src/core/            Scanner, dictionary, LLM, packer, logs, and core logic
│   └── tauri.conf.json      Window, bundling, and updater config
├── tests/                   Vitest tests and fixtures
├── CHANGELOG.md             Changelog
├── LICENSE                  MIT license
├── README.en-US.md          English README
└── README.md                Chinese README
```

## Tech Stack

### Frontend

- React 18
- TypeScript 5
- Vite 6
- Zustand
- react-virtuoso
- lucide-react
- Vitest + Testing Library

### Backend

- Tauri 2
- Rust 2021
- Rayon
- reqwest
- rusqlite
- serde / serde_json
- zip
- tracing

## Project Rules

- Do not modify original mod JARs.
- Do not replace existing user resource packs without confirmation.
- Resource-pack output uses `assets/<modid>/lang/<targetLanguage>.json`.
- Frontend and backend models are synchronized through camelCase JSON. Update both `src/types.ts` and `src-tauri/src/core/models.rs` when changing shared data structures.
- New UI text must be added to `src/i18n/translations.ts`.

## Documentation

See [docs/00-index.md](docs/00-index.md) for the full documentation index.

## References

- [MineAI-Modpack-Translator](https://github.com/Thedrezik/MineAI-Modpack-Translator)
- [mc-autotranslator](https://gitee.com/li27744/mc-autotranslator)

## License

This project is licensed under the [MIT License](LICENSE).
