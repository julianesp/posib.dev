/**
 * CUFE, CUDE y código de seguridad del software contra los ejemplos oficiales
 * del Anexo Técnico FE v1.9 (§11.2 p.657 y §11.4.3 p.665). Si estos hashes
 * coinciden, la fórmula es la misma que usa la DIAN para validar.
 */
import { buildCufeString, formatMonto, generateCude, generateCufe, softwareSecurityCode, sha384Hex } from '../fe-dian/cufe';

describe('CUFE (factura)', () => {
  const ejemplo = {
    numFac: '323200000129',
    fecFac: '2019-01-16',
    horFac: '10:53:10-05:00',
    valFac: 1500000,
    valIva: 285000,
    valInc: 0,
    valIca: 0,
    valTot: 1785000,
    nitOFE: '700085371',
    numAdq: '800199436',
    clTec: '693ff6f2a553c3646a063436fd4dd9ded0311471',
    tipoAmbiente: 1 as const,
  };

  it('arma la cadena base igual que el anexo', () => {
    expect(buildCufeString(ejemplo)).toBe(
      '3232000001292019-01-1610:53:10-05:001500000.0001285000.00040.00030.001785000.00700085371800199436693ff6f2a553c3646a063436fd4dd9ded03114711',
    );
  });

  it('reproduce el hash oficial', async () => {
    expect(await generateCufe(ejemplo)).toBe(
      '8bb918b19ba22a694f1da11c643b5e9de39adf60311cf179179e9b33381030bcd4c3c3f156c506ed5908f9276f5bd9b4',
    );
  });

  it('trunca (no redondea) los montos a 2 decimales', () => {
    expect(formatMonto(1500000)).toBe('1500000.00');
    expect(formatMonto(285000.999)).toBe('285000.99');
    expect(formatMonto(0)).toBe('0.00');
  });
});

describe('CUDE (nota crédito)', () => {
  it('reproduce el ejemplo oficial con el PIN del software', async () => {
    const cude = await generateCude({
      numFac: '8110007871',
      fecFac: '2019-01-12',
      horFac: '07:00:00-05:00',
      valFac: 5000,
      valIva: 950,
      valInc: 0,
      valIca: 0,
      valTot: 5950,
      nitOFE: '900373076',
      numAdq: '8355990',
      pinSoftware: '12301',
      tipoAmbiente: 1,
    });
    expect(cude).toBe(
      '907e4444decc9e59c160a2fb3b6659b33dc5b632a5008922b9a62f83f757b1c448e47f5867f2b50dbdb96f48c7681168',
    );
  });
});

describe('código de seguridad del software', () => {
  it('es SHA-384(softwareId + pin + número)', async () => {
    expect(await softwareSecurityCode('abc-123', '12345', 'SETP990000001')).toBe(await sha384Hex('abc-12312345SETP990000001'));
  });
});
