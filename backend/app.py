"""
Drape Virtual Try-On Backend
Uses the Gradio client to call the official zhengchong/CatVTON space
(which runs on ZeroGPU with the full CatVTON pipeline).

This proxy approach means:
- We don't need to host the heavy model ourselves (saves ~8GB)
- We get the full, correctly implemented CatVTON pipeline
- Our space just handles routing, CORS, and multi-image selection
"""

import gradio as gr
import spaces
from gradio_client import Client, handle_file
from PIL import Image
import io
import base64
import tempfile
import os

# ── Gradio client to call CatVTON ──────────────────────
# The official CatVTON space is public and free to call.
catvton_client = None

def get_client():
    global catvton_client
    if catvton_client is None:
        catvton_client = Client("zhengchong/CatVTON")
    return catvton_client


@spaces.GPU
def virtual_tryon(
    person_image: Image.Image,
    garment_image: Image.Image,
    cloth_type: str = "upper",          # "upper" | "lower" | "overall"
    num_steps: int = 50,
    guidance_scale: float = 2.5,
    seed: int = 42,
):
    """
    Sends the person photo and garment photo to CatVTON and returns
    a photorealistic image of the person wearing the garment.
    """
    if person_image is None or garment_image is None:
        raise gr.Error("Both a person photo and a garment photo are required.")

    client = get_client()

    # Save images to temp files (gradio_client requires file paths)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as pf:
        person_image.save(pf.name)
        person_path = pf.name

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as gf:
        garment_image.save(gf.name)
        garment_path = gf.name

    try:
        result = client.predict(
            person_image={
                "background": handle_file(person_path),
                "layers": [],
                "composite": None,
            },
            cloth_image=handle_file(garment_path),
            cloth_type=cloth_type,
            num_inference_steps=num_steps,
            guidance_scale=guidance_scale,
            seed=seed,
            show_type="result only",
            api_name="/submit_function",
        )

        # result is a file path to the generated image
        if isinstance(result, str) and os.path.exists(result):
            return Image.open(result).convert("RGB")
        elif isinstance(result, dict) and "value" in result:
            return Image.open(result["value"]).convert("RGB")
        else:
            raise gr.Error(f"Unexpected result format: {type(result)}")

    finally:
        os.unlink(person_path)
        os.unlink(garment_path)


# ── Gradio UI ───────────────────────────────────────────
with gr.Blocks(title="Drape — AI Virtual Try-On") as demo:
    gr.Markdown("""
    ## Drape — AI Virtual Try-On
    Upload a full-body person photo and a garment photo to generate a realistic try-on.
    *Powered by CatVTON via Hugging Face ZeroGPU.*
    """)

    with gr.Row():
        with gr.Column():
            person_input  = gr.Image(type="pil", label="📸 Person Photo (full body)")
            garment_input = gr.Image(type="pil", label="👕 Garment Photo (product image)")
            cloth_type    = gr.Radio(
                choices=["upper", "lower", "overall"],
                value="upper",
                label="Garment Type",
            )
            generate_btn  = gr.Button("✨ Generate Try-On", variant="primary", size="lg")

        with gr.Column():
            output_image = gr.Image(type="pil", label="🎉 Result")

    generate_btn.click(
        fn=virtual_tryon,
        inputs=[person_input, garment_input, cloth_type],
        outputs=output_image,
    )

demo.launch()
