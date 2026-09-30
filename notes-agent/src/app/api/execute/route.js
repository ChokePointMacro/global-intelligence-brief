import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function POST(req) {
  const { cmd, cwd } = await req.json();

  if (!cmd?.startsWith('claude ')) {
    return Response.json({ error: 'Only claude commands are permitted.' }, { status: 400 });
  }

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: cwd || process.env.HOME,
      timeout: 300_000, // 5 min
      env: { ...process.env },
    });

    return Response.json({ success: true, stdout, stderr });
  } catch (err) {
    return Response.json({
      success: false,
      error: err.message,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
    }, { status: 500 });
  }
}
