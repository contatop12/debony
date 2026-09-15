import { captureAttribution } from './attribution';
import { initContactForms } from './contact-form';
import { onReady } from './dom';
import { initLightbox } from './lightbox';
import { initSmoothAnchors } from './smooth-anchors';

// Antes do DOM: só depende da URL, e precisa ter rodado quando o visitante navegar.
captureAttribution();

onReady(() => {
  initContactForms();
  initLightbox();
  initSmoothAnchors();
});
