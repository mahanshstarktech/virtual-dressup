from fastapi import FastAPI, UploadFile, File
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
import rembg
import gradio as gr
import spaces

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# We can initialize it globally here because HF Spaces gives 16GB RAM
# and gives you plenty of time to boot up!
print("Initializing U2Net-Clothing model...")
session = rembg.new_session("u2net_cloth_seg")

@spaces.GPU
def process_image(contents):
    return rembg.remove(contents, session=session)

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/api/remove-bg")
async def remove_bg(file: UploadFile = File(...)):
    contents = await file.read()
    output_image = process_image(contents)
    return Response(content=output_image, media_type="image/png")

# Gradio requires a basic UI to be defined to run a Space.
# We MUST pass a @spaces.GPU decorated function directly into the Interface
# so that Hugging Face's ZeroGPU startup checks can detect it.

@spaces.GPU
def dummy_gpu_task():
    return "Backend API is running! Endpoint: /api/remove-bg"

demo = gr.Interface(
    fn=dummy_gpu_task,
    inputs=None,
    outputs="text",
    title="Virtual Dressup Backend"
)

app = gr.mount_gradio_app(app, demo, path="/")
