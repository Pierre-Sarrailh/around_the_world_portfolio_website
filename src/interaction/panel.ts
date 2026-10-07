import type { Project } from '../types';

/**
 * The slide-in project panel. It owns nothing but DOM — the scene keeps
 * running behind it, and closing is always available via Escape.
 */
export function createPanel(onClose?: () => void) {
  const panel = document.getElementById('panel') as HTMLElement;
  const body = document.getElementById('panel-body') as HTMLElement;
  const closeButton = document.getElementById('panel-close') as HTMLButtonElement;

  let current: Project | null = null;

  function close() {
    if (!current) return;
    current = null;
    panel.classList.remove('panel--open');
    panel.setAttribute('aria-hidden', 'true');
    onClose?.();
  }

  function open(project: Project) {
    current = project;

    body.replaceChildren();

    const title = document.createElement('h2');
    title.textContent = project.title;

    const tagline = document.createElement('p');
    tagline.className = 'panel__tagline';
    tagline.textContent = project.tagline;

    const description = document.createElement('p');
    description.className = 'panel__description';
    description.textContent = project.description;

    const tags = document.createElement('ul');
    tags.className = 'panel__tags';
    for (const tag of project.tags) {
      const item = document.createElement('li');
      item.textContent = tag;
      tags.append(item);
    }

    const links = document.createElement('div');
    links.className = 'panel__links';
    for (const link of project.links) {
      const anchor = document.createElement('a');
      anchor.href = link.href;
      anchor.textContent = link.label;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      links.append(anchor);
    }

    body.append(title, tagline, description, tags, links);

    panel.classList.add('panel--open');
    panel.setAttribute('aria-hidden', 'false');
    closeButton.focus();
  }

  closeButton.addEventListener('click', close);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  return { open, close, isOpen: () => current !== null };
}
