"""Run in Logging.toe Textport. Tests only this example; reopen to discard tests."""
from pathlib import Path
repo=next(p for p in (Path(project.folder),*Path(project.folder).parents) if (p/'tools/td-native-build').is_dir())
root=op('/project1/logging_example')
runner=root.create(textDAT,'verification');runner.text=(repo/'packages/native-webgpu/test/logging/td_steps.py').read_text(encoding='utf-8');runner.module.advance()
