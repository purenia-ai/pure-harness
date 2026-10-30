# PureHub Desktop

English | [中文](README.zh.md)

> **This is a modified fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT).** PureHub Desktop is maintained by PURESNAKE. It is **not affiliated with, endorsed by, or sponsored by DeepSeek**. The upstream project owns the DeepSeek Harness name, its documentation, and its community channels.

PureHub Desktop is a desktop agent harness built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [docs/](docs/) · Upstream documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Developer preview

PureHub Desktop is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/purenia-ai/pure-harness.git
cd pure-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Report bugs and request features in the [fork's issue tracker](https://github.com/purenia-ai/pure-harness/issues).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- The [DeepSeek Harness Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) and its Discord belong to the upstream project, not to this fork.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in one terminal, and `make help` lists the matching Make targets for Web and Desktop; the guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md).

## Attribution

This project is a modified fork of DeepSeek Harness (MIT), Copyright (c) 2026 DeepSeek. Cite the upstream project when you refer to the harness itself:

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE) — the original DeepSeek copyright notice is retained verbatim; PURESNAKE's modifications are noted in the same file.

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
