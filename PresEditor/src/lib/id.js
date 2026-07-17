let counter = 0;

export function uid(prefix = 'id') {
  counter += 1;
  return `${prefix}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}
