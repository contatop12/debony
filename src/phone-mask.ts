/**
 * Máscara do campo de telefone: formata enquanto o visitante digita, no padrão
 * brasileiro, e não deixa passar de 11 dígitos.
 *
 *   10 dígitos  (11) 5687-7566
 *   11 dígitos  (11) 98765-4321
 *
 * "+55" na frente (colado ou digitado) é descartado assim que passa de 11
 * dígitos, e o cursor acompanha o dígito em que estava, então dá para corrigir
 * o DDD sem o texto pular para o fim. Sem maxlength no input de propósito: com
 * ele o navegador barraria o 12.º dígito antes de a máscara ver o +55.
 */

const MAX_DIGITOS = 11;

/** Só os dígitos nacionais: tira o +55 quando vem junto e corta em 11. */
export function digitosTelefone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('55') && d.length > MAX_DIGITOS) d = d.slice(2);
  return d.slice(0, MAX_DIGITOS);
}

/** Formato completo com 10 ou 11 dígitos; parcial enquanto ainda está digitando. */
export function formatarTelefone(raw: string): string {
  const d = digitosTelefone(raw);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Posição do cursor no texto formatado, logo depois do n-ésimo dígito. */
function posicaoAposDigitos(texto: string, n: number): number {
  if (n <= 0) return 0;
  let vistos = 0;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto.charAt(i);
    if (ch >= '0' && ch <= '9') {
      vistos++;
      if (vistos === n) return i + 1;
    }
  }
  return texto.length;
}

export function aplicarMascaraTelefone(input: HTMLInputElement): void {
  input.value = formatarTelefone(input.value);
  let ultimosDigitos = digitosTelefone(input.value);

  input.addEventListener('input', (event) => {
    const inputType = (event as InputEvent).inputType ?? '';
    const caret = input.selectionStart ?? input.value.length;
    let plano = input.value.replace(/\D/g, '');
    let digitosAntesDoCursor = input.value.slice(0, caret).replace(/\D/g, '').length;

    // Backspace em cima de ")" ou "-" não tira dígito nenhum, e a máscara
    // recolocaria o separador: o cursor ficaria preso. O que o visitante quis
    // foi apagar o dígito anterior.
    if (inputType === 'deleteContentBackward' && plano === ultimosDigitos && digitosAntesDoCursor > 0) {
      plano = plano.slice(0, digitosAntesDoCursor - 1) + plano.slice(digitosAntesDoCursor);
      digitosAntesDoCursor--;
    }

    const digitos = digitosTelefone(plano);
    const formatado = formatarTelefone(digitos);
    ultimosDigitos = digitos;
    input.value = formatado;

    // Com +55 descartado ou dígitos além do limite, o cursor vai para o fim;
    // no resto, acompanha o dígito em que estava.
    const pos = digitos.length === plano.length ? posicaoAposDigitos(formatado, digitosAntesDoCursor) : formatado.length;
    input.setSelectionRange(pos, pos);
  });
}
