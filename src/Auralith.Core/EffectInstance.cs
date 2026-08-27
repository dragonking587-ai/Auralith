namespace Auralith.Core;

public sealed class EffectInstance
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public EffectKind Kind { get; set; } = EffectKind.Glow;
    public bool Enabled { get; set; } = true;
    public AudioSource Audio { get; set; } = AudioSource.FullMix;
    public float Intensity { get; set; } = 0.7f;
    public float Sensitivity { get; set; } = 0.7f;
    public float Threshold { get; set; } = 0.15f;
    public float Attack { get; set; } = 0.05f;
    public float Release { get; set; } = 0.2f;
    public float Speed { get; set; } = 1f;
    public float Spread { get; set; } = 0.5f;
    public float Falloff { get; set; } = 0.5f;
    public float Opacity { get; set; } = 1f;
    public BlendMode Blend { get; set; } = BlendMode.Add;
    public QualityLevel Quality { get; set; } = QualityLevel.Medium;
    public uint PrimaryColor { get; set; } = 0xFFD4AF37;
    public uint SecondaryColor { get; set; } = 0xFF7DD3FC;
    public bool InvertResponse { get; set; }
    public float Randomness { get; set; }
    public int Seed { get; set; } = 1;
}

public sealed class EffectStack
{
    public List<EffectInstance> Items { get; set; } = new();

    public void Add(EffectKind kind) => Items.Add(new EffectInstance { Kind = kind });
    public void Remove(Guid id) => Items.RemoveAll(i => i.Id == id);
    public void Move(int from, int to)
    {
        if (from < 0 || to < 0 || from >= Items.Count || to >= Items.Count) return;
        var item = Items[from];
        Items.RemoveAt(from);
        Items.Insert(to, item);
    }
}
