import { describe, expect, it } from 'test-anywhere';

import { previewText } from '../experiments/telegram-preview-text.mjs';

describe('Telegram preview text', () => {
  it('strips a tag split by another tag', () => {
    expect(previewText('a<scr<b>ipt>alert(1)</scr</b>ipt>b')).toBe(
      'aalert(1)b'
    );
  });

  it('keeps line breaks and decodes entities once', () => {
    expect(
      previewText('<b>Studio</b><br/>8&nbsp;tr &amp;lt;x&gt; &#127968;')
    ).toBe('Studio\n8 tr &lt;x> 🏠');
  });
});
