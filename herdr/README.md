# Herdr configuration

## Restore

Copy the tracked files manually:

```sh
mkdir -p ~/.config/herdr ~/.config/herdr-mirror
cp config.toml ~/.config/herdr/config.toml
cp herdr-mirror/hosts.toml ~/.config/herdr-mirror/hosts.toml
```

Or symlink them from this repository:

```sh
mkdir -p ~/.config/herdr ~/.config/herdr-mirror
ln -sfn "$PWD/config.toml" ~/.config/herdr/config.toml
ln -sfn "$PWD/herdr-mirror/hosts.toml" ~/.config/herdr-mirror/hosts.toml
```

## Intentionally excluded

This backup excludes runtime and session data, plugin registry metadata, logs and sockets, mirror map state, generated integrations, and build artifacts.
