import QRCode from 'qrcode';

export async function generateQrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 0,
    color: { dark: '#000000', light: '#ffffff' },
  });
}
