/** The small label that follows the cursor while a satellite is hovered. */
export function createTooltip() {
  const element = document.getElementById('tooltip') as HTMLElement;

  return {
    show(text: string, x: number, y: number) {
      element.textContent = text;
      element.style.transform = `translate(${x + 16}px, ${y + 16}px)`;
      element.setAttribute('aria-hidden', 'false');
      element.classList.add('tooltip--visible');
    },
    hide() {
      element.classList.remove('tooltip--visible');
      element.setAttribute('aria-hidden', 'true');
    },
  };
}
