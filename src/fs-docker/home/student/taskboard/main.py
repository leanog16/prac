from fastapi import FastAPI

app = FastAPI(title="Taskboard", version="1.0.0")


@app.get("/")
def root():
    return {"name": "Taskboard", "version": "1.0.0"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/tasks")
def list_tasks():
    return [{"id": 1, "title": "Set up repo", "status": "done"}, {"id": 2, "title": "Write API", "status": "doing"}]


@app.get("/tasks/{task_id}")
def get_task(task_id: int):
    return {"id": task_id, "title": "Example task", "status": "todo"}
