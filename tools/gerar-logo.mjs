/**
 * Gera as versões da logo usadas no site a partir do PNG original.
 *
 * O PNG com fundo transparente fica em public/assets/img como fonte da verdade;
 * daqui saem os WebP (com transparência) nos tamanhos do srcset do cabeçalho e
 * do rodapé. Para trocar a logo: substitua o PNG e rode `npm run logo`.
 *
 * Os arquivos gerados são versionados, e não criados no build da Vercel, para
 * o deploy não depender do binário nativo do sharp no ambiente de CI.
 *
 * Uso: node tools/gerar-logo.mjs
 */

import sharp from 'sharp';
import { stat } from 'node:fs/promises';

const ORIGEM = 'public/assets/img/logo-debony-joluma.png';
// 511 é a largura exibida; 1079 (a original) atende telas de alta densidade.
export const LARGURAS = [200, 300, 511, 1079];

const meta = await sharp(ORIGEM).metadata();
if (!meta.hasAlpha) {
  throw new Error(`${ORIGEM} não tem canal alfa: a logo precisa ter fundo transparente`);
}

for (const largura of LARGURAS) {
  const destino = `public/assets/img/logo-debony-joluma-${largura}.webp`;
  await sharp(ORIGEM)
    .resize({ width: Math.min(largura, meta.width) })
    .webp({ quality: 90, alphaQuality: 100, effort: 6 })
    .toFile(destino);
  const { size } = await stat(destino);
  console.log(`${destino}  ${(size / 1024).toFixed(1)} KB`);
}
