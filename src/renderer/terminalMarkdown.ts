import {
  addImportVisitor$,
  lexical,
  realmPlugin,
  type MdastImportVisitor
} from '@mdxeditor/editor'
import type { Html } from 'mdast'

export const rawHtmlTextVisitor: MdastImportVisitor<Html> = {
  testNode: 'html',
  priority: -100,
  visitNode({ actions, lexicalParent, mdastNode }) {
    const textNode = lexical.$createTextNode(mdastNode.value)
    textNode.setFormat(actions.getParentFormatting())

    const style = actions.getParentStyle()
    if (style) textNode.setStyle(style)

    if (lexicalParent.getType() === 'root') {
      const paragraphNode = lexical.$createParagraphNode()
      paragraphNode.append(textNode)
      actions.addAndStepInto(paragraphNode)
      return
    }

    actions.addAndStepInto(textNode)
  }
}

export const terminalMarkdownPlugin = realmPlugin({
  init(realm) {
    realm.pub(addImportVisitor$, rawHtmlTextVisitor)
  }
})
