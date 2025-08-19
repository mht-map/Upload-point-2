import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export const runtime = 'nodejs';           // ensure Node APIs
export const dynamic = 'force-dynamic';    // avoid edge

export async function POST(req: Request) {
  try {
    console.log('Upload request received');
    
    const form = await req.formData();
    const file = form.get('file') as File | null;
    
    if (!file) {
      console.log('No file in request');
      return NextResponse.json({ error: 'No file' }, { status: 400 });
    }

    console.log('File received:', { name: file.name, type: file.type, size: file.size });

    // Basic validation
    const allowed = ['image/png','image/jpeg','image/webp', 'image/jpg'];
    if (!allowed.includes(file.type)) {
      console.log('Unsupported file type:', file.type);
      return NextResponse.json({ error: 'Unsupported type' }, { status: 415 });
    }
    
    if (file.size > 10 * 1024 * 1024) { // 10 MB
      console.log('File too large:', file.size);
      return NextResponse.json({ error: 'Too large' }, { status: 413 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log('File converted to buffer, size:', buffer.length);

    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    console.log('Uploads directory:', uploadsDir);
    
    await mkdir(uploadsDir, { recursive: true });
    console.log('Directory created/verified');

    const id = crypto.randomBytes(8).toString('hex');
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const filename = `${id}.${ext}`;
    const filepath = path.join(uploadsDir, filename);
    
    console.log('Writing file to:', filepath);
    await writeFile(filepath, buffer);
    console.log('File written successfully');

    const response = { 
      url: `/uploads/${filename}`,
      id: id,
      filename: filename,
      originalName: file.name,
      size: file.size,
      type: file.type
    };
    
    console.log('Upload successful, returning:', response);
    return NextResponse.json(response);
    
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Server error: ' + (error instanceof Error ? error.message : 'Unknown error') }, { status: 500 });
  }
}
