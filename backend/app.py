import gradio as gr
import spaces
import rembg
from PIL import Image
import io

session = None

@spaces.GPU
def remove_clothing_bg(image):
    """
    Takes a PIL Image, removes the background using U2Net-Clothing,
    and returns a PIL Image with a transparent background.
    This function runs on ZeroGPU when called via Gradio's queue.
    """
    global session
    if session is None:
        session = rembg.new_session("u2net_cloth_seg")

    # Convert PIL -> bytes
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    img_bytes = buf.getvalue()

    # Run U2Net clothing segmentation
    output_bytes = rembg.remove(img_bytes, session=session)

    # Convert bytes -> PIL and return
    return Image.open(io.BytesIO(output_bytes)).convert("RGBA")


demo = gr.Interface(
    fn=remove_clothing_bg,
    inputs=gr.Image(type="pil", label="Upload Clothing Image"),
    outputs=gr.Image(type="pil", label="Segmented Clothing"),
    title="Virtual Dressup — Clothing Segmentation API",
    description="Upload a photo of a garment. The AI will remove the background and extract only the clothing.",
)

demo.launch()
