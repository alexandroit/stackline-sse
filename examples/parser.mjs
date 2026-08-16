import { createParser } from '@stackline/sse';

const parser = createParser({
  onEvent(event) {
    console.log(event);
  }
});

parser.feed('id: 1\ndata: hello\n');
parser.feed('data: world\n\n');
