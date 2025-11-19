import Computer from 'tzafon';

async function scrapeWikipedia() {
  const client = new (Computer as any)();
  const computer = await client.create({ kind: 'browser' });

  console.log('🔵 Navigating to https://www.wikipedia.org/ ...');
  await computer.navigate('https://www.wikipedia.org/');
  await computer.wait(2);

  console.log('⌨️ Filling search input (using debug) and submitting...');
  // This debug runs in page context, sets the input value and submits the form (or clicks the search button).
  const setAndSubmit = `
    (function(){
      const input = document.getElementById('searchInput');
      if(!input) return JSON.stringify({ok:false, reason:'no-input'});
      input.focus();
      input.value = 'Intel';
      // Try to submit form if present
      const form = input.closest('form');
      if(form){ form.submit(); return JSON.stringify({ok:true, method:'form.submit'}); }
      // Otherwise try clicking the search button
      const btn = document.querySelector('button.pure-button-primary-progressive');
      if(btn){ btn.click(); return JSON.stringify({ok:true, method:'button.click'}); }
      // fallback: dispatch Enter key
      const ev = new KeyboardEvent('keydown', {key:'Enter', code:'Enter', bubbles:true});
      input.dispatchEvent(ev);
      return JSON.stringify({ok:true, method:'keydown'});
    })();
  `;
  const submitResultRaw = await computer.debug(setAndSubmit);
  console.log('submit result:', submitResultRaw);

  // Wait for navigation / page load after submit
  await computer.wait(3);

  console.log('🔎 Extracting title and first paragraph (using debug)...');
  const extract = `
    (function(){
      const h1 = document.querySelector('h1');
      // Choose first paragraph inside #mw-content-text if available to avoid nav/infobox paragraphs
      const content = document.querySelector('#mw-content-text') || document;
      const p = content.querySelector('p');
      const title = h1 ? h1.textContent.trim() : null;
      const firstParagraph = p ? p.textContent.trim() : null;
      return JSON.stringify({ title, firstParagraph });
    })();
  `;
  const extractedRaw = await computer.debug(extract);

  let extracted: { title: string | null; firstParagraph: string | null } = { title: null, firstParagraph: null };
  try {
    extracted = JSON.parse(typeof extractedRaw === 'string' ? extractedRaw : JSON.stringify(extractedRaw));
  } catch (err) {
    console.warn('Failed to parse extraction result:', extractedRaw, err);
  }

  console.log('📄 Title:', extracted.title);
  console.log('✂️ First paragraph (preview):', extracted.firstParagraph?.slice(0, 400) ?? null);

  console.log('📸 Taking screenshot...');
  const shotResult = await computer.screenshot();
  console.log('screenshot response:', shotResult);

  await computer.close();
  console.log('✅ Done.');
}

scrapeWikipedia().catch((e) => {
  console.error('Error:', e);
});
