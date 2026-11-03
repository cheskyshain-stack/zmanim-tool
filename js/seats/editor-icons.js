const paths = {
  pencil: 'm15 4 5 5M4 20l4-1L20 7l-5-5L3 14l-1 6Z',
  save: 'M5 3h12l4 4v14H3V3h2Zm2 0v7h10V3M7 21v-7h10v7',
  print: 'M7 8V3h10v5M7 17H3V8h18v9h-4M7 13h10v8H7ZM17 11h1',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  undo: 'M8 4 3 9l5 5M3 9h10a7 7 0 0 1 0 14H9',
  redo: 'm16 4 5 5-5 5m5-5H11a7 7 0 0 0 0 14h4',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  check: 'm5 12 4 4L19 6',
  plus: 'M12 5v14M5 12h14',
};

export function seatsEditorIcon(name) {
  return `<svg class="editor-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${paths[name]}"/></svg>`;
}
