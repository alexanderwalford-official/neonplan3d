#!/bin/bash
# Fork: the Linux half of tools/fork-sync.ps1, run inside WSL. Builds and checks the fork the way upstream's CI does.
#
#   fork-sync-wsl.sh setup                    Node 24 and uv (for Python 3.13) into ~/.local, checked against their
#                                             published SHA-256 sums; no sudo. Skips what is already there.
#   fork-sync-wsl.sh check REPO               Copies REPO (a /mnt/c/... path) to ~/neonplan3d-build, then: npm ci,
#                                             typecheck, frontend tests, build (size budgets), Python tests, ruff.
#                                             The built bundles are copied back into REPO. Exits non-zero on a failure.
#   fork-sync-wsl.sh zip REPO OUT             Packs REPO's custom_components/neonplan3d as HACS wants it (files at the
#                                             zip root, no caches) into OUT.
#   fork-sync-wsl.sh hacs-check OWNER/REPO    Downloads that repository's latest release the way HACS does
#                                             (upstream's tools/hacs_download_check.py with the repository swapped).
set -uo pipefail

NODE_DIR=$HOME/.local/node
UV_DIR=$HOME/.local/uvtool
WORK=$HOME/neonplan3d-build
export PATH=$NODE_DIR/bin:$PATH

step() { printf '\n== %s\n' "$*"; }
fail() { printf '\nFAILED: %s\n' "$*" >&2; exit 1; }

setup() {
  if [ ! -x "$NODE_DIR/bin/node" ]; then
    step "Installing Node 24 into $NODE_DIR"
    local tmp
    tmp=$(mktemp -d) && cd "$tmp" || fail "no temp dir"
    curl -fsSLO https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt || fail "Node checksum list"
    local f
    f=$(grep -o 'node-v24[^ ]*-linux-x64\.tar\.xz' SHASUMS256.txt) || fail "Node release name"
    curl -fsSLO "https://nodejs.org/dist/latest-v24.x/$f" || fail "Node download"
    grep " $f\$" SHASUMS256.txt | sha256sum -c - || fail "Node checksum"
    rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR" && tar -xJf "$f" -C "$NODE_DIR" --strip-components=1 || fail "Node unpack"
    cd / && rm -rf "$tmp"
  fi
  if [ ! -x "$UV_DIR/uv" ]; then
    step "Installing uv into $UV_DIR"
    mkdir -p "$UV_DIR" && cd "$UV_DIR" || fail "uv dir"
    local t=uv-x86_64-unknown-linux-gnu.tar.gz
    curl -fsSLO "https://github.com/astral-sh/uv/releases/latest/download/$t" || fail "uv download"
    curl -fsSLO "https://github.com/astral-sh/uv/releases/latest/download/$t.sha256" || fail "uv checksum download"
    sha256sum -c "$t.sha256" || fail "uv checksum"
    tar -xzf "$t" --strip-components=1 || fail "uv unpack"
  fi
  echo "node $("$NODE_DIR/bin/node" --version), $("$UV_DIR/uv" --version)"
}

sync_copy() {
  local repo=$1
  mkdir -p "$WORK"
  # node_modules and the venv stay between runs (npm ci and uv keep them current)
  rsync -a --delete --exclude .git --exclude node_modules --exclude .venv \
    --filter='P frontend/node_modules' --filter='P .venv' "$repo/" "$WORK/" || fail "copy to $WORK"
}

check() {
  local repo=${1:?REPO missing}
  [ -d "$repo/custom_components/neonplan3d" ] || fail "$repo is not the NeonPlan 3D repository"
  setup >/dev/null || fail "setup"
  step "Copying the repository to $WORK"
  sync_copy "$repo"
  cd "$WORK/frontend" || fail "frontend"
  step "npm ci"
  npm ci --no-audit --no-fund --loglevel=error || fail "npm ci"
  step "Typecheck"
  npm run --silent typecheck || fail "typecheck"
  step "Frontend tests"
  node --test --test-reporter=dot "src/**/*.test.ts" || fail "frontend tests"
  step "Build (with the size budgets)"
  npm run --silent build || fail "build"
  cd "$WORK" || fail "work dir"
  step "Python 3.13 and the test requirements"
  [ -x .venv/bin/python ] || "$UV_DIR/uv" venv -q -p 3.13 .venv || fail "venv"
  "$UV_DIR/uv" pip install -q -p .venv/bin/python -r requirements_test.txt ruff || fail "Python requirements"
  step "Python tests"
  .venv/bin/python -m pytest -q -p no:cacheprovider tests || fail "Python tests"
  step "ruff"
  .venv/bin/ruff check custom_components tests || fail "ruff check"
  .venv/bin/ruff format --check custom_components tests || fail "ruff format"
  step "Copying the built bundles back"
  rsync -a "$WORK/custom_components/neonplan3d/frontend/" "$repo/custom_components/neonplan3d/frontend/" || fail "copy back"
  rsync -a "$WORK/site/import/" "$repo/site/import/" || fail "copy back"
  echo "All checks passed."
}

make_zip() {
  local repo=${1:?REPO missing} out=${2:?OUT missing}
  python3 -I - "$repo/custom_components/neonplan3d" "$out" <<'PY' || fail "zip"
import pathlib, sys, zipfile
src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
out.unlink(missing_ok=True)
files = sorted(f for f in src.rglob("*") if f.is_file() and "__pycache__" not in f.parts and f.suffix != ".pyc")
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in files:
        z.write(f, f.relative_to(src).as_posix())
names = zipfile.ZipFile(out).namelist()
assert "manifest.json" in names and not any("\\" in n for n in names), "bad zip layout"
print(f"{len(names)} files, {out.stat().st_size / 1e6:.2f} MB -> {out}")
PY
}

hacs_check() {
  local repo=${1:?OWNER/REPO missing}
  [ -x "$WORK/.venv/bin/python" ] || fail "run check first (it sets up Python)"
  sed "s|^REPO = .*|REPO = \"$repo\"|" "$WORK/tools/hacs_download_check.py" > "$WORK/tools/hacs_check_fork.py" || fail "checker"
  "$WORK/.venv/bin/python" "$WORK/tools/hacs_check_fork.py" || fail "HACS download check"
}

case "${1:-}" in
  setup) setup ;;
  check) check "${2:-}" ;;
  zip) make_zip "${2:-}" "${3:-}" ;;
  hacs-check) hacs_check "${2:-}" ;;
  *) echo "usage: $0 setup | check REPO | zip REPO OUT | hacs-check OWNER/REPO" >&2; exit 2 ;;
esac
