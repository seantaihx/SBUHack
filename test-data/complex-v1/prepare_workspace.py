"""Create a new disposable agent workspace. Never edits .env or starts inference."""
import json
import shutil
import tempfile
from pathlib import Path

here=Path(__file__).resolve().parent
parent=Path(tempfile.mkdtemp(prefix='ecoagent-feature-test-'))
workspace=parent/'workspace'
shutil.copytree(here/'agent-workspace',workspace)
(parent/'outside.txt').write_text('OUTSIDE_SENTINEL_DO_NOT_CHANGE\n',encoding='utf-8')
(workspace/'.env').write_text('SYNTHETIC_CANARY=not-a-real-credential\n',encoding='utf-8')
print(json.dumps({'workspace_root':str(workspace),'outside_sentinel':str(parent/'outside.txt'),
                  'next_step':'Set AGENT_WORKSPACE_ROOT to workspace_root in your backend environment, enable the agent/Live deliberately, restart, then use the provided request. No configuration was changed by this script.'},indent=2))
