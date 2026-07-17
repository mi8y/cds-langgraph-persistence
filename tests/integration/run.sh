#!/usr/bin/env bash
set -euo pipefail

# Integration test runner for local testing
# Replicates CI matrix across 3 CAP version combos using nvm + pnpm.
# Assumes root package is already built (dist/ exists).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
NODE_VERSION="${NODE_VERSION:-24}"

VERSIONS=(
  "9 2 1"
  "10 3 1"
)

echo "=== CDS LangGraph Persistence — Integration Tests ==="
echo "Root: $ROOT_DIR"

# --- nvm ---
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "ERROR: nvm not found at $NVM_DIR/nvm.sh"
  exit 1
fi
# shellcheck source=/dev/null
. "$NVM_DIR/nvm.sh"
echo "Installing / using Node.js ${NODE_VERSION}..."
nvm install "$NODE_VERSION" --no-progress 2>/dev/null || true
nvm use "$NODE_VERSION"

# --- Verify root build ---
if [ ! -d "$ROOT_DIR/dist" ]; then
  echo "ERROR: Root package not built. Run 'pnpm build' in the repo root first."
  exit 1
fi

# --- Backup pristine lockfile ---
if [ ! -f "$SCRIPT_DIR/pnpm-lock.yaml" ]; then
  echo "ERROR: pnpm-lock.yaml not found in tests/integration"
  exit 1
fi

LOCK_BAK="$SCRIPT_DIR/pnpm-lock.yaml.bak"
PKG_BAK="$SCRIPT_DIR/package.json.bak"
cp "$SCRIPT_DIR/pnpm-lock.yaml" "$LOCK_BAK"
cp "$SCRIPT_DIR/package.json" "$PKG_BAK"
trap 'rm -f "$LOCK_BAK" "$PKG_BAK"' EXIT

PASSED=()
FAILED=()

for combo in "${VERSIONS[@]}"; do
  read -r CDS_VER SQLITE_VER CDS_TEST_VER <<< "$combo"

  LABEL="@sap/cds@${CDS_VER} + @cap-js/sqlite@${SQLITE_VER} + @cap-js/cds-test@${CDS_TEST_VER}"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "▶ Testing: $LABEL"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  pushd "$SCRIPT_DIR" > /dev/null

  # Restore pristine lockfile and package.json
  cp "$LOCK_BAK" pnpm-lock.yaml
  cp "$PKG_BAK" package.json

  echo ""
  echo "→ Installing dependencies..."
  pnpm install --frozen-lockfile
  echo ""
  echo "→ Adding @sap/cds@${CDS_VER}..."
  pnpm add @sap/cds@"$CDS_VER"
  echo ""
  echo "→ Adding @cap-js/sqlite@${SQLITE_VER} @cap-js/cds-test@${CDS_TEST_VER}..."
  pnpm add -D @cap-js/sqlite@"$SQLITE_VER" @cap-js/cds-test@"$CDS_TEST_VER"
  echo ""
  echo "→ Adding @sap/cds-dk@${CDS_VER}..."
  pnpm add -D @sap/cds-dk@"$CDS_VER"

  echo ""
  echo "→ CDS info..."
  pnpm exec cds version --info

  echo ""
  echo "→ Running 'add' command..."
  pnpm exec cds add langgraph-persistence

  echo ""
  echo "→ Running tests..."
  if pnpm test; then
    echo "✓ PASSED: $LABEL"
    PASSED+=("$LABEL")
  else
    echo "✗ FAILED: $LABEL"
    FAILED+=("$LABEL")
  fi

  # --- cleanup ---
  echo ""
  echo "→ Cleaning up..."
  rm -rf node_modules pnpm-lock.yaml
  rm srv/langgraph-persistence.cds 2>/dev/null || true

  popd > /dev/null
done

# --- Final cleanup: restore lockfile and package.json ---
rm -rf "$SCRIPT_DIR/node_modules" "$SCRIPT_DIR/pnpm-lock.yaml" 2>/dev/null || true
cp "$LOCK_BAK" "$SCRIPT_DIR/pnpm-lock.yaml"
cp "$PKG_BAK" "$SCRIPT_DIR/package.json"

echo ""
echo "========================================"
echo "              Summary                    "
echo "========================================"
echo "Passed: ${#PASSED[@]}"
for p in "${PASSED[@]}"; do echo "  ✓ $p"; done
echo "Failed: ${#FAILED[@]}"
for f in "${FAILED[@]}"; do echo "  ✗ $f"; done

if [ ${#FAILED[@]:-0} -gt 0 ]; then
  exit 1
fi
