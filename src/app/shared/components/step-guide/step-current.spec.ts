import { currentStepKey } from './step-current';

describe('currentStepKey（いまの段階。11/27）', () => {
  it('済み・していない段を飛ばして、最初のまだ・要確認の段', () => {
    expect(currentStepKey([{ key: 'a', state: 'done' }, { key: 'b', state: 'skipped' }, { key: 'c', state: 'attention' }, { key: 'd', state: 'todo' }])).toBe('c');
    expect(currentStepKey([{ key: 'a', state: 'todo' }, { key: 'b', state: 'attention' }])).toBe('a');
  });
  it('全部済みなら null', () => {
    expect(currentStepKey([{ key: 'a', state: 'done' }, { key: 'b', state: 'skipped' }])).toBeNull();
  });
});
