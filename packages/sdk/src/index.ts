/**
 * @paskamer/sdk — the merchant drop-in.
 *
 * IIFE build (dist/sdk.v1.js): auto-initialises from the <script> tag's data-* attributes.
 * ESM build (dist/sdk.v1.esm.js): import { init } and call it yourself (auto-init is a no-op
 * without a `script[data-shop]` tag on the page).
 */
import { autoInit } from './sdk';

export { init, open, configure, getConfig, scan, destroy, autoInit, isMobile, findScriptTag, configFromScript, api, PRODUCT_ATTR } from './sdk';
export { openModal, closeModal, currentModal, minutesLeft, svgToDataUrl } from './modal';
export type { ModalContent, ModalHandle, ModalOptions } from './modal';
export { encodeQr, qrToSvg } from './qr';
export type { QrMatrix, QrSvgOptions } from './qr';
export { pickStrings, STRINGS, ESTIMATE_DISCLAIMER } from './i18n';
export type { Strings } from './i18n';
export { CSS, STYLE_ID, injectStyles } from './styles';
export { VERSION } from './version';
export type { PaskamerApi, PaskamerConfig, OpenMode, OpenOptions, OpenResult, SdkSessionRequest, SdkSessionResponse } from './types';

autoInit();
