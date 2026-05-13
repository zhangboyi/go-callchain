export interface CodeLensAction {
  title: string;
  command: string;
}

export function goFunctionCodeLensActions(): CodeLensAction[] {
  return [
    {
      title: 'Show Callchain',
      command: 'goCallchain.showFunctionCallchainAtLocation',
    },
  ];
}
