import { Ref } from "vue"

export default function setSelectEvent(
  isMouseDown: Ref<boolean>,
  top: Ref<number>,
  left: Ref<number>,
  width: Ref<number>,
  height: Ref<number>,
  isSelected: Ref<boolean>
){
  // 监听鼠标按下事件
  window.addEventListener('mousedown', (e) => {
    // 判断鼠标是否点击在 pickerCheck 区域
    const pickerCheck = document.querySelector('.picker-utils')
    const pickerCheckRect = pickerCheck?.getBoundingClientRect()
    if (
      (pickerCheckRect &&
      e.clientX >= pickerCheckRect.left &&
      e.clientX <= pickerCheckRect.right &&
      e.clientY >= pickerCheckRect.top &&
      e.clientY <= pickerCheckRect.bottom) ||
      isSelected.value
    ) {
      return
    } else {
      isMouseDown.value = true
      const { clientX, clientY } = e
      left.value = clientX
      top.value = clientY
    }
  })

  // 监听鼠标移动事件
  window.addEventListener('mousemove', (e) => {
    if (isMouseDown.value) {
      const { clientX, clientY } = e
      width.value = Math.abs(clientX - left.value)
      height.value = Math.abs(clientY - top.value)
      left.value = Math.min(clientX, left.value)
      top.value = Math.min(clientY, top.value)
    }
  })

  // 监听鼠标抬起事件
  window.addEventListener('mouseup', () => {
    isMouseDown.value = false
    isSelected.value = true
  })
}
