// 自绘原生窗口栏。窗体仍保留系统缩放、最小/最大化、任务栏及键盘 Snap 样式。
using System;
using System.Drawing;
using System.Windows.Forms;
using System.Runtime.InteropServices;
namespace CftNative {
  public class Frame : NativeWindow {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X,Y; }
    [StructLayout(LayoutKind.Sequential)] struct MINMAX { public POINT Reserved,MaxSize,MaxPosition,MinTrack,MaxTrack; }
    [StructLayout(LayoutKind.Sequential)] struct MONITOR { public int Size; public RECT Bounds,Work; public int Flags; }
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h,int i);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h,int i,int v);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int w,int z,uint f);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out RECT r);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h,int f);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr h,ref MONITOR m);
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h,int m,IntPtr w,IntPtr l);
    [DllImport("user32.dll")] static extern bool RedrawWindow(IntPtr h,IntPtr r,IntPtr region,uint flags);
    public void Repaint(){RedrawWindow(Handle,IntPtr.Zero,IntPtr.Zero,0x485);}
    public void BeginResize(int edge){
      if(edge<1||edge>8||IsZoomed(Handle))return;
      // 常态不添加 THICKFRAME，避免 WinForms 无框窗口留下旧尺寸非客户区白框。
      int style=GetWindowLong(Handle,-16);SetWindowLong(Handle,-16,style|0x00040000);Refresh();
      try{ReleaseCapture();SendMessage(Handle,0x112,(IntPtr)(0xf000|edge),IntPtr.Zero);}
      finally{if(Handle!=IntPtr.Zero){SetWindowLong(Handle,-16,GetWindowLong(Handle,-16)&~0x00040000);Refresh();Repaint();}}
    }
    public int TitleHeight=48, Edge=6, ControlsWidth=138;
    int oldStyle;
    public Frame(IntPtr hwnd) { AssignHandle(hwnd);oldStyle=GetWindowLong(hwnd,-16);SetWindowLong(hwnd,-16,(oldStyle & ~0x00c40000)|0x00010000|0x00020000|0x00080000);Refresh(); }
    public void Refresh() { SetWindowPos(Handle,IntPtr.Zero,0,0,0,0,0x37); }
    public int Hit(int x,int y) {
      RECT r;GetWindowRect(Handle,out r);x-=r.L;y-=r.T;
      if(!IsZoomed(Handle)) {
        bool l=x<Edge,t=y<Edge,rr=x>=r.R-r.L-Edge,b=y>=r.B-r.T-Edge;
        if(t&&l)return 13;if(t&&rr)return 14;if(b&&l)return 16;if(b&&rr)return 17;
        if(l)return 10;if(rr)return 11;if(t)return 12;if(b)return 15;
      }
      return y<TitleHeight && x<r.R-r.L-ControlsWidth ? 2 : 1;
    }
    protected override void WndProc(ref Message m) {
      if(m.Msg==0x83 && m.WParam!=IntPtr.Zero) { // WM_NCCALCSIZE: 内容扩展到整个窗体。
        // 不把监视器绝对坐标写进 NCCALCSIZE，最大化工作区在 GETMINMAXINFO 管理。
        m.Result=IntPtr.Zero;return;
      }
      if(m.Msg==0x24){ // WM_GETMINMAXINFO: 尊重任务栏、多屏和 WinForms 最小尺寸。
        base.WndProc(ref m);MONITOR v=new MONITOR();v.Size=Marshal.SizeOf(v);
        if(GetMonitorInfo(MonitorFromWindow(Handle,2),ref v)){
          MINMAX limits=(MINMAX)Marshal.PtrToStructure(m.LParam,typeof(MINMAX));
          limits.MaxPosition.X=v.Work.L-v.Bounds.L;limits.MaxPosition.Y=v.Work.T-v.Bounds.T;
          limits.MaxSize.X=v.Work.R-v.Work.L;limits.MaxSize.Y=v.Work.B-v.Work.T;
          Marshal.StructureToPtr(limits,m.LParam,false);
        }return;
      }
      if(m.Msg==0x84){long p=m.LParam.ToInt64();m.Result=(IntPtr)Hit((short)(p&0xffff),(short)((p>>16)&0xffff));return;}
      base.WndProc(ref m);
    }
    public void RestoreFrame(){IntPtr h=Handle;int state=GetWindowLong(h,-16)&0x31000000;SetWindowLong(h,-16,(oldStyle&~0x31000000)|state);ReleaseHandle();SetWindowPos(h,IntPtr.Zero,0,0,0,0,0x27);}
  }
  public class PassCaption : NativeWindow {
    public PassCaption(Control c){AssignHandle(c.Handle);}
    protected override void WndProc(ref Message m){if(m.Msg==0x84){m.Result=(IntPtr)(-1);return;}base.WndProc(ref m);}
  }
  public class CaptionButton : Button {
    public int Kind; public Color Normal,Hover; public bool Maximized;
    public CaptionButton(int kind){Kind=kind;FlatStyle=FlatStyle.Flat;FlatAppearance.BorderSize=0;TabStop=true;Text="";SetStyle(ControlStyles.UserPaint|ControlStyles.OptimizedDoubleBuffer,true);AccessibleName=kind==0?"最小化":kind==1?"最大化或还原":"关闭";}
    protected override void OnMouseEnter(EventArgs e){BackColor=Hover;base.OnMouseEnter(e);}
    protected override void OnMouseLeave(EventArgs e){BackColor=Normal;base.OnMouseLeave(e);}
    protected override void OnPaint(PaintEventArgs e){
      e.Graphics.Clear(BackColor);float s=Height/42f,cx=Width/2f,cy=Height/2f,d=5*s;
      using(Pen pen=new Pen(ForeColor,1.3f*s)){
        if(Kind==0)e.Graphics.DrawLine(pen,cx-d,cy+2*s,cx+d,cy+2*s);
        else if(Kind==2){e.Graphics.DrawLine(pen,cx-d,cy-d,cx+d,cy+d);e.Graphics.DrawLine(pen,cx-d,cy+d,cx+d,cy-d);}
        else {if(Maximized)e.Graphics.DrawRectangle(pen,cx-d+2*s,cy-d-2*s,d*2,d*2);e.Graphics.DrawRectangle(pen,cx-d,cy-d,d*2,d*2);}
      }
    }
  }
}
