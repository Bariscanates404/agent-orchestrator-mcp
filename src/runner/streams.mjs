import fs from 'node:fs';

export function bindProcessStreams(task, spawnedChild, writeEvent) {
  const stdoutStream = fs.createWriteStream(task.logs.stdout, { flags: 'a' });
  const stderrStream = fs.createWriteStream(task.logs.stderr, { flags: 'a' });

  spawnedChild.stdout?.on('data', (chunk) => {
    const text = chunk.toString();
    stdoutStream.write(text);
    writeEvent('stdout', 'stdout_chunk', text, { agentPid: spawnedChild.pid });
  });

  spawnedChild.stderr?.on('data', (chunk) => {
    const text = chunk.toString();
    stderrStream.write(text);
    writeEvent('stderr', 'stderr_chunk', text, { agentPid: spawnedChild.pid });
  });

  return { stdoutStream, stderrStream };
}

export async function closeStreams(stdoutStream, stderrStream) {
  await Promise.all([
    stdoutStream ? new Promise((resolve) => stdoutStream.end(resolve)) : Promise.resolve(),
    stderrStream ? new Promise((resolve) => stderrStream.end(resolve)) : Promise.resolve(),
  ]);
}
