'use strict';

const parsePresets = {
  ai: {
    label: 'AI token stream',
    input: 'event: response.output_text.delta\nid: evt-101\ndata: {"delta":"Hel"}\n\nevent: response.output_text.delta\nid: evt-102\ndata: {"delta":"lo"}\n\ndata: [DONE]\n\n'
  },
  resume: {
    label: 'Resume checkpoint',
    input: ': keep-alive\nretry: 1500\nid: checkpoint-41\n\nevent: order.updated\nid: checkpoint-42\ndata: first line\ndata: second line\n\n'
  },
  boundaries: {
    label: 'UTF-8 and chunk boundaries',
    input: 'id: café-7\nevent: greeting\ndata: Olá, streaming world.\n\n'
  },
  strict: {
    label: 'Unknown field handling',
    input: 'trace: ignored-by-the-spec\nid: 88\ndata: valid event\n\n'
  }
};

const encodePresets = {
  json: {
    label: 'JSON delta',
    input: '{\n  "event": "delta",\n  "id": "43",\n  "data": "{\\"token\\":\\"hello\\"}"\n}'
  },
  multiline: {
    label: 'Multiline message',
    input: '{\n  "event": "article",\n  "id": "44",\n  "data": "line one\\nline two"\n}'
  },
  control: {
    label: 'Retry and comment',
    input: '[\n  { "comment": "keep-alive" },\n  { "retry": 3000, "id": "45", "data": "ready" }\n]'
  }
};

const state = {
  mode: 'parse',
  output: ''
};

const elements = {
  chunkControl: document.querySelector('#chunk-control'),
  chunkSize: document.querySelector('#chunk-size'),
  copyInstall: document.querySelector('#copy-install'),
  copyOutput: document.querySelector('#copy-output'),
  error: document.querySelector('#error-output'),
  input: document.querySelector('#stream-input'),
  inputLabel: document.querySelector('#input-label'),
  inputNote: document.querySelector('#input-note'),
  metrics: document.querySelector('#metrics'),
  modeEncode: document.querySelector('#mode-encode'),
  modeParse: document.querySelector('#mode-parse'),
  output: document.querySelector('#result-output'),
  preset: document.querySelector('#preset'),
  resultTitle: document.querySelector('#result-title'),
  run: document.querySelector('#run'),
  strict: document.querySelector('#strict'),
  strictControl: document.querySelector('#strict-control')
};

function selectMode(mode) {
  state.mode = mode;
  const parsing = mode === 'parse';
  elements.modeParse.classList.toggle('active', parsing);
  elements.modeEncode.classList.toggle('active', !parsing);
  elements.modeParse.setAttribute('aria-selected', String(parsing));
  elements.modeEncode.setAttribute('aria-selected', String(!parsing));
  elements.strictControl.hidden = !parsing;
  elements.chunkControl.hidden = !parsing;
  elements.inputLabel.textContent = parsing ? 'SSE input' : 'Message JSON';
  elements.inputNote.textContent = parsing
    ? 'The parser receives this stream in incremental chunks.'
    : 'Encode one message object or an array of message objects.';
  elements.run.textContent = parsing ? 'Run parser' : 'Encode message';
  elements.resultTitle.textContent = parsing ? 'Parsed events' : 'Encoded stream';
  loadPresetOptions();
}

function loadPresetOptions() {
  const presets = state.mode === 'parse' ? parsePresets : encodePresets;
  elements.preset.replaceChildren();
  for (const [value, preset] of Object.entries(presets)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = preset.label;
    elements.preset.append(option);
  }
  loadSelectedPreset();
}

function loadSelectedPreset() {
  const presets = state.mode === 'parse' ? parsePresets : encodePresets;
  elements.input.value = presets[elements.preset.value].input;
  runCurrentMode();
}

function runCurrentMode() {
  clearError();
  try {
    if (state.mode === 'parse') runParser();
    else runEncoder();
  } catch (error) {
    showError(error);
  }
}

function runParser() {
  const events = [];
  const warnings = [];
  const retries = [];
  const parser = StacklineSSE.createParser({
    strict: elements.strict.checked,
    onError(error) {
      warnings.push({ code: error.code, message: error.message });
    },
    onEvent(event) {
      events.push(event);
    },
    onRetry(delay) {
      retries.push(delay);
    }
  });
  const source = elements.input.value;
  const chunkSize = Math.max(1, Math.min(65536, Number(elements.chunkSize.value) || 1));
  for (let offset = 0; offset < source.length; offset += chunkSize) {
    parser.feed(source.slice(offset, offset + chunkSize));
  }
  parser.end();
  const result = { events, warnings, retries, state: parser.state };
  state.output = JSON.stringify(result, null, 2);
  renderMetrics([
    ['Events', events.length],
    ['Characters', parser.state.characters.toLocaleString()],
    ['Last ID', parser.state.lastEventId || 'none'],
    ['Warnings', warnings.length]
  ]);
  renderEvents(events, warnings, retries);
}

function runEncoder() {
  const value = JSON.parse(elements.input.value);
  const messages = Array.isArray(value) ? value : [value];
  if (messages.length > 1000) throw new RangeError('The playground accepts at most 1,000 messages at once.');
  const encoded = messages.map((message) => StacklineSSE.encodeSSE(message)).join('');
  state.output = encoded;
  renderMetrics([
    ['Messages', messages.length],
    ['Characters', encoded.length.toLocaleString()],
    ['Lines', encoded.split('\n').length - 1],
    ['Dependencies', 0]
  ]);
  const pre = document.createElement('pre');
  pre.className = 'encoded-output';
  pre.textContent = encoded;
  elements.output.replaceChildren(pre);
}

function renderMetrics(items) {
  const nodes = items.map(([label, value]) => {
    const item = document.createElement('div');
    const term = document.createElement('span');
    const detail = document.createElement('strong');
    term.textContent = label;
    detail.textContent = String(value);
    item.append(term, detail);
    return item;
  });
  elements.metrics.replaceChildren(...nodes);
}

function renderEvents(events, warnings, retries) {
  const fragment = document.createDocumentFragment();
  if (events.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-result';
    empty.textContent = 'No complete event was dispatched.';
    fragment.append(empty);
  }
  events.forEach((event, index) => {
    const article = document.createElement('article');
    article.className = 'event-result';
    const header = document.createElement('div');
    const number = document.createElement('strong');
    const type = document.createElement('span');
    number.textContent = `Event ${index + 1}`;
    type.textContent = event.event || 'message';
    header.append(number, type);
    const data = document.createElement('pre');
    data.textContent = event.data;
    const metadata = document.createElement('p');
    metadata.textContent = `id: ${event.id === undefined ? 'inherited' : event.id || 'empty'}  |  resume: ${event.lastEventId || 'none'}`;
    article.append(header, data, metadata);
    fragment.append(article);
  });
  if (retries.length > 0 || warnings.length > 0) {
    const diagnostics = document.createElement('pre');
    diagnostics.className = 'diagnostics';
    diagnostics.textContent = JSON.stringify({ retries, warnings }, null, 2);
    fragment.append(diagnostics);
  }
  elements.output.replaceChildren(fragment);
}

function showError(error) {
  state.output = `${error.name}: ${error.message}`;
  elements.output.replaceChildren();
  elements.metrics.replaceChildren();
  elements.error.hidden = false;
  elements.error.textContent = state.output;
}

function clearError() {
  elements.error.hidden = true;
  elements.error.textContent = '';
}

async function copyText(value, button) {
  try {
    await navigator.clipboard.writeText(value);
    const original = button.textContent;
    button.textContent = 'Copied';
    window.setTimeout(() => {
      button.textContent = original;
    }, 1400);
  } catch {
    button.textContent = 'Copy failed';
  }
}

elements.modeParse.addEventListener('click', () => selectMode('parse'));
elements.modeEncode.addEventListener('click', () => selectMode('encode'));
elements.preset.addEventListener('change', loadSelectedPreset);
elements.run.addEventListener('click', runCurrentMode);
elements.strict.addEventListener('change', runCurrentMode);
elements.copyInstall.addEventListener('click', () => copyText('npm install @stackline/sse', elements.copyInstall));
elements.copyOutput.addEventListener('click', () => copyText(state.output, elements.copyOutput));

for (const button of document.querySelectorAll('.copy-code')) {
  button.addEventListener('click', () => {
    const target = document.querySelector(`#${button.dataset.copyTarget}`);
    copyText(target.textContent, button);
  });
}

selectMode('parse');
