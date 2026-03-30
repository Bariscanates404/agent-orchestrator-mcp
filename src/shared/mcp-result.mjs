export function toTextResult(title, data) {
  return {
    content: [
      {
        type: 'text',
        text: `${title}\n${JSON.stringify(data, null, 2)}`,
      },
    ],
    structuredContent: data,
  };
}

export function unwrapToolResult(result) {
  if (result?.isError) {
    const message = result.content?.find((item) => item.type === 'text')?.text || 'Tool call failed';
    throw new Error(message);
  }
  return result.structuredContent;
}
