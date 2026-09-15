"""JSON bridge for the independent reference; no JavaScript execution or imports."""
import json
from pathlib import Path
import sys

# npm may hoist Paperchain beside this package or keep it nested. Search the
# ancestor dependency directories so installed artifact tools remain usable.
reference = next((parent / "node_modules/paperchain/conformance/python"
                  for parent in Path(__file__).resolve().parents
                  if (parent / "node_modules/paperchain/conformance/python/extended_corpus.py").is_file()), None)
if reference is None:
    raise SystemExit("Install a compatible paperchain package to use its Python reference.")
sys.path.insert(0, str(reference))
if len(sys.argv) > 1 and sys.argv[1] == "--corpus":
    from extended_corpus import main
    raise SystemExit(main(sys.argv[2:]))
import paperfold as fold


def unwrap(result):
    if not result["ok"]:
        raise ValueError(result["errors"])
    return result["value"]


def check(case):
    scene = case["kind"] == "scene"
    apply = fold.apply_scene_patch if scene else fold.apply_patch
    diff = fold.diff_scenes if scene else fold.diff_bodies
    invert = fold.invert_scene_patch if scene else fold.invert_patch
    compose = fold.compose_scene_patches if scene else fold.compose_patches
    a, b, ts_patch, ts_inverse = (case[key] for key in ("a", "b", "patch", "inverse"))
    applied = unwrap(apply(a, ts_patch))
    python_patch = unwrap(diff(a, b))
    python_inverse = invert(python_patch)
    return {
        "tsApplied": applied,
        "tsRestored": unwrap(apply(applied, ts_inverse)),
        "tsComposed": unwrap(apply(a, compose(ts_patch, ts_inverse))),
        "patch": python_patch,
        "inverse": python_inverse,
    }

print(json.dumps([check(case) for case in json.load(sys.stdin)], allow_nan=False))
