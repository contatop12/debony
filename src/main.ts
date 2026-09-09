import { initContactForms } from './contact-form';
import { onReady } from './dom';
import { initLightbox } from './lightbox';
import { initSmoothAnchors } from './smooth-anchors';

onReady(() => {
  initContactForms();
  initLightbox();
  initSmoothAnchors();
});
