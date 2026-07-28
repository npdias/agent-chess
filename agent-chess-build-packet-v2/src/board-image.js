import { deflateSync } from 'node:zlib';

const BOARD_SIZE = 512;
const SQUARE_SIZE = BOARD_SIZE / 8;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const LIGHT_SQUARE = [240, 217, 181, 255];
const DARK_SQUARE = [181, 136, 99, 255];
const WHITE_TOKEN = [248, 250, 252, 255];
const BLACK_TOKEN = [17, 24, 39, 255];
const TOKEN_BORDER = [71, 85, 105, 255];

const LETTERS = Object.freeze({
  P: ['01110', '10001', '10001', '11110', '10000', '10000', '10000'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
});

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return crc >>> 0;
});

function piecesFromFen(fen) {
  const ranks = String(fen).trim().split(/\s+/)[0].split('/');
  const pieces = [];
  for (const [rankIndex, rank] of ranks.entries()) {
    let fileIndex = 0;
    for (const symbol of rank) {
      if (/\d/.test(symbol)) {
        fileIndex += Number(symbol);
        continue;
      }
      if (LETTERS[symbol.toUpperCase()]) {
        pieces.push({
          letter: symbol.toUpperCase(),
          color: symbol === symbol.toUpperCase() ? 'white' : 'black',
          x: fileIndex,
          y: rankIndex,
        });
      }
      fileIndex += 1;
    }
  }
  return pieces;
}

function setPixel(pixels, x, y, color) {
  if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return;
  const offset = (y * BOARD_SIZE + x) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3];
}

function fillRect(pixels, x, y, width, height, color) {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) setPixel(pixels, px, py, color);
  }
}

function fillCircle(pixels, centerX, centerY, radius, color) {
  const radiusSquared = radius * radius;
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if ((dx * dx) + (dy * dy) <= radiusSquared) setPixel(pixels, x, y, color);
    }
  }
}

function drawLetter(pixels, letter, centerX, centerY, color) {
  const glyph = LETTERS[letter];
  const scale = 5;
  const width = glyph[0].length * scale;
  const height = glyph.length * scale;
  const startX = Math.round(centerX - (width / 2));
  const startY = Math.round(centerY - (height / 2));
  for (const [row, bits] of glyph.entries()) {
    for (const [column, bit] of [...bits].entries()) {
      if (bit === '1') {
        fillRect(pixels, startX + (column * scale), startY + (row * scale), scale, scale, color);
      }
    }
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function encodePng(pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(BOARD_SIZE, 0);
  header.writeUInt32BE(BOARD_SIZE, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const scanlines = Buffer.alloc((BOARD_SIZE * 4 + 1) * BOARD_SIZE);
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    const targetOffset = y * (BOARD_SIZE * 4 + 1);
    scanlines[targetOffset] = 0;
    pixels.copy(scanlines, targetOffset + 1, y * BOARD_SIZE * 4, (y + 1) * BOARD_SIZE * 4);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function renderBoardImage(fen) {
  const sideToMove = String(fen).trim().split(/\s+/)[1] === 'b' ? 'Black' : 'White';
  const alt = `Canonical board position from authoritative FEN. ${sideToMove} to move.`;
  const pixels = Buffer.alloc(BOARD_SIZE * BOARD_SIZE * 4);

  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      fillRect(
        pixels,
        file * SQUARE_SIZE,
        rank * SQUARE_SIZE,
        SQUARE_SIZE,
        SQUARE_SIZE,
        (rank + file) % 2 === 0 ? LIGHT_SQUARE : DARK_SQUARE,
      );
    }
  }

  for (const piece of piecesFromFen(fen)) {
    const centerX = piece.x * SQUARE_SIZE + SQUARE_SIZE / 2;
    const centerY = piece.y * SQUARE_SIZE + SQUARE_SIZE / 2;
    fillCircle(pixels, centerX, centerY, 25, TOKEN_BORDER);
    fillCircle(pixels, centerX, centerY, 22, piece.color === 'white' ? WHITE_TOKEN : BLACK_TOKEN);
    drawLetter(
      pixels,
      piece.letter,
      centerX,
      centerY,
      piece.color === 'white' ? BLACK_TOKEN : WHITE_TOKEN,
    );
  }

  const png = encodePng(pixels);
  return {
    type: 'image',
    mimeType: 'image/png',
    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    alt,
  };
}
