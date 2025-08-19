import { NextResponse } from 'next/server';
import { unlink } from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req: Request) {
  try {
    console.log('Delete request received');
    
    const { filename } = await req.json();
    console.log('Delete request for filename:', filename);
    
    if (!filename) {
      console.log('No filename provided');
      return NextResponse.json({ error: 'Filename is required' }, { status: 400 });
    }

    // Security check: prevent directory traversal
    if (/[\\/]/.test(filename)) {
      console.log('Invalid filename with path separators:', filename);
      return NextResponse.json({ error: 'Bad filename' }, { status: 400 });
    }

    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    const filepath = path.join(uploadsDir, filename);
    
    console.log('Attempting to delete file:', filepath);
    
    // Only allow deletion from uploads directory for security
    if (!filepath.startsWith(uploadsDir)) {
      console.log('Security violation: filepath outside uploads directory');
      return NextResponse.json({ error: 'Invalid file path' }, { status: 403 });
    }

    await unlink(filepath).catch(() => {}); // ignore if already gone
    console.log('File deleted successfully');
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete error:', error);
    return NextResponse.json({ error: 'Server error: ' + (error instanceof Error ? error.message : 'Unknown error') }, { status: 500 });
  }
}
