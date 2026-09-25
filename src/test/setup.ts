import '@testing-library/jest-dom/vitest';

/* jsdom has no pointer-capture or scrollIntoView implementation. Radix's Select
   (and other Radix pieces built on the same primitive) call these when opening,
   so without a shim every test that opens one throws outside jsdom's support. */
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
