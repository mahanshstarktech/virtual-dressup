from fastapi import FastAPI, UploadFile, File
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
import rembg

app = FastAPI()

# Allow CORS for the PWA hosted on Cloudflare Pages
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict this to your domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize the U2Net-Clothing model
# This runs once when the server starts.
session = rembg.new_session("u2net_cloth_seg")

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/api/remove-bg")
async def remove_bg(file: UploadFile = File(...)):
    contents = await file.read()
    
    # Process the image with the clothing segmentation model
    output_image = rembg.remove(contents, session=session)
    
    return Response(content=output_image, media_type="image/png")
