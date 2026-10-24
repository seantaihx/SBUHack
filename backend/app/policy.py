from .schemas import Policy, Reason, Role, Task


def route(task: Task, policy: Policy) -> tuple[Role, Reason]:
    if policy == 'baseline':
        return 'large', 'baseline_large'
    if task.type == 'summarize':
        return 'large', 'summary_large'
    return 'small', 'simple_task_small'
